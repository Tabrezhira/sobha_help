const makeWASocket = require('baileys').default;
const {
	useMultiFileAuthState,
	DisconnectReason,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
} = require('baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');

class WhatsAppConnection {
	constructor({ logger, authDir, onMessage }) {
		this.logger = logger;
		this.authDir = authDir || path.join(__dirname, '../../', 'auth_info');
		this.sock = null;
		this.qr = null;
		this.connectionState = 'disconnected';
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 5;
		this.onMessage = onMessage; // Callback for incoming messages
	}

	async connect() {
		try {
			const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
			const { version } = await fetchLatestBaileysVersion();

			this.sock = makeWASocket({
				version,
				logger: this.logger,
				printQRInTerminal: false,
				auth: {
					creds: state.creds,
					keys: makeCacheableSignalKeyStore(state.keys, this.logger),
				},
				browser: ['Sobha Salary Slip', 'Chrome', '120.0.0'],
				getMessage: async () => undefined,
				syncFullHistory: false,
				markOnlineOnConnect: false,
			});

			this.sock.ev.on('creds.update', saveCreds);

			// Listen for incoming messages
			this.sock.ev.on('messages.upsert', async (m) => {
				if (m.type === 'notify' && this.onMessage) {
					for (const message of m.messages) {
						// Only process messages from others (not sent by us)
						if (!message.key.fromMe) {
							this.onMessage(message);
						}
					}
				}
			});

			this.sock.ev.on('connection.update', async (update) => {
				const { connection, lastDisconnect, qr } = update;

				if (qr) {
					this.qr = qr;
					this.logger?.info('QR Code received, scan to authenticate');
					qrcode.generate(qr, { small: true });
				}

				if (connection === 'close') {
					const statusCode = lastDisconnect?.error?.output?.statusCode;
					const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

					this.connectionState = 'disconnected';
					this.qr = null;
					
					this.logger?.warn(
						{ 
							shouldReconnect, 
							attempts: this.reconnectAttempts,
							statusCode,
							reason: Object.keys(DisconnectReason).find(key => DisconnectReason[key] === statusCode)
						},
						'connection closed'
					);

					if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
						this.reconnectAttempts++;
						setTimeout(() => this.connect(), 3000);
					} else if (!shouldReconnect) {
						this.logger?.info('logged out, clear auth to reconnect');
					}
				} else if (connection === 'open') {
					this.connectionState = 'connected';
					this.reconnectAttempts = 0;
					this.qr = null;
					this.logger?.info('WhatsApp connection established');
				} else if (connection === 'connecting') {
					this.connectionState = 'connecting';
				}
			});

			return this.sock;
		} catch (err) {
			this.logger?.error({ err }, 'failed to initialize WhatsApp connection');
			throw err;
		}
	}

	getSocket() {
		return this.sock;
	}

	getStatus() {
		return {
			state: this.connectionState,
			qr: this.qr,
			reconnectAttempts: this.reconnectAttempts,
		};
	}

	async disconnect() {
		if (this.sock) {
			await this.sock.logout();
			this.sock = null;
			this.connectionState = 'disconnected';
			this.logger?.info('WhatsApp disconnected');
		}
	}

	async logoutAndReconnect() {
		try {
			// Logout from current session if connected
			if (this.sock && this.connectionState === 'connected') {
				try {
					await this.sock.logout();
				} catch (logoutErr) {
					this.logger?.warn({ logoutErr }, 'logout failed, continuing with cleanup');
				}
			}

			this.sock = null;
			this.connectionState = 'disconnected';
			this.reconnectAttempts = 0;
			this.qr = null;

			// Clear auth state by removing the directory
			const fs = require('fs');
			if (fs.existsSync(this.authDir)) {
				fs.rmSync(this.authDir, { recursive: true, force: true });
				this.logger?.info('Cleared auth state');
			}

			// Wait a moment before reconnecting
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Reconnect with fresh state
			await this.connect();

			this.logger?.info('Logout and reconnect completed, scan new QR code');
			return { success: true, message: 'Logged out and new QR code generated' };
		} catch (err) {
			this.logger?.error({ err }, 'failed to logout and reconnect');
			throw err;
		}
	}
}

module.exports = WhatsAppConnection;
