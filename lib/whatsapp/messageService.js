const fs = require('fs');

class MessageService {
	constructor({ connection, logger }) {
		this.connection = connection;
		this.logger = logger;
	}

	formatPhoneNumber(mobile) {
		if (!mobile) {
			throw new Error('Mobile number is required');
		}

		let digits = String(mobile).replace(/[^0-9]/g, '');

		// If it doesn't start with country code, assume India (+91)
		if (!digits.startsWith('91') && digits.length === 10) {
			digits = '91' + digits;
		}

		return digits + '@s.whatsapp.net';
	}

	async sendDocument({ to, filePath, caption, fileName }) {
		const sock = this.connection.getSocket();

		if (!sock) {
			throw new Error('WhatsApp not connected');
		}

		const status = this.connection.getStatus();
		if (status.state !== 'connected') {
			throw new Error(`WhatsApp is ${status.state}, not ready to send`);
		}

		const jid = this.formatPhoneNumber(to);

		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const fileBuffer = await fs.promises.readFile(filePath);

		const message = {
			document: fileBuffer,
			fileName: fileName || 'document.pdf',
			mimetype: 'application/pdf',
		};

		if (caption) {
			message.caption = caption;
		}

		const result = await sock.sendMessage(jid, message);

		this.logger?.info({ to: jid, fileName }, 'document sent successfully');

		return result;
	}

	async sendText({ to, text }) {
		const sock = this.connection.getSocket();

		if (!sock) {
			throw new Error('WhatsApp not connected');
		}

		const status = this.connection.getStatus();
		if (status.state !== 'connected') {
			throw new Error(`WhatsApp is ${status.state}, not ready to send`);
		}

		const jid = this.formatPhoneNumber(to);

		const result = await sock.sendMessage(jid, { text });

		this.logger?.info({ to: jid }, 'text message sent');

		return result;
	}
}

module.exports = MessageService;
