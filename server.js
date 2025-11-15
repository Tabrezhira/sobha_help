const express = require('express');
const boom = require('@hapi/boom');
const pino = require('pino');
const EmployeeRepository = require('./lib/repositories/employeeRepository');
const SalarySlipRepository = require('./lib/repositories/salarySlipRepository');
const DataStore = require('./lib/services/dataStore');
const WhatsAppConnection = require('./lib/whatsapp/connection');
const MessageService = require('./lib/whatsapp/messageService');
const WhatsAppChatbot = require('./lib/whatsapp/chatbot');
const config = require('./lib/config');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Basic request logger to capture method, path, status, and response time.
app.use((req, res, next) => {
	const start = Date.now();

	res.on('finish', () => {
		logger.info({
			method: req.method,
			url: req.originalUrl,
			status: res.statusCode,
			durationMs: Date.now() - start,
		});
	});

	next();
});

app.get('/health', (req, res) => {
	res.json({ status: 'ok' });
});

const employeeRepository = new EmployeeRepository({ workbookPath: config.employeeWorkbookPath, logger });
const salarySlipRepository = new SalarySlipRepository({ directoryPath: config.salarySlipDir, filePattern: config.pdfFilePattern, logger });
const dataStore = new DataStore({ employeeRepository, salarySlipRepository, logger });

// Initialize chatbot first (needed for WhatsApp connection)
let chatbot;
const handleIncomingMessage = (message) => {
	if (chatbot) {
		chatbot.handleIncomingMessage(message);
	}
};

const whatsappConnection = new WhatsAppConnection({ logger, onMessage: handleIncomingMessage });
const messageService = new MessageService({ connection: whatsappConnection, logger });
chatbot = new WhatsAppChatbot({ dataStore, messageService, logger });

// Cleanup old conversations every 15 minutes
setInterval(() => {
	chatbot.cleanupOldConversations(30);
}, 15 * 60 * 1000);

app.get('/employees', (req, res, next) => {
	try {
		const limit = Number.parseInt(req.query.limit, 10) || 100;
		const offset = Number.parseInt(req.query.offset, 10) || 0;

		if (limit < 1 || limit > 1000) {
			throw boom.badRequest('limit must be between 1 and 1000');
		}

		if (offset < 0) {
			throw boom.badRequest('offset must be zero or positive');
		}

		const records = dataStore.listEmployees();
		const slice = records.slice(offset, offset + limit);

		res.json({
			total: records.length,
			limit,
			offset,
			items: slice,
		});
	} catch (err) {
		next(err);
	}
});

app.get('/employees/:empid', (req, res, next) => {
	try {
		const record = dataStore.getEmployee(req.params.empid);

		if (!record) {
			throw boom.notFound('Employee not found');
		}

		res.json(record);
	} catch (err) {
		next(err);
	}
});

app.get('/employees/:empid/salary-slip', (req, res, next) => {
	try {
		const record = dataStore.getEmployee(req.params.empid);

		if (!record) {
			throw boom.notFound('Employee not found');
		}

		if (!record.salarySlip) {
			throw boom.notFound('Salary slip not available for this employee');
		}

		res.sendFile(record.salarySlip.absolutePath);
	} catch (err) {
		next(err);
	}
});

app.post('/salary-slip', async (req, res, next) => {
	try {
		const empid = typeof req.body.empid === 'string' ? req.body.empid.trim() : null;

		if (!empid) {
			throw boom.badRequest('empid is required in the request body');
		}

		const result = await dataStore.getEmployeeWithSalarySlipContent(empid);

		if (!result) {
			throw boom.notFound('Employee not found');
		}

		if (!result.salarySlip || !result.pdfBuffer) {
			throw boom.notFound('Salary slip not available for this employee');
		}

		res.set('Content-Type', 'application/pdf');
		res.set('Content-Disposition', `inline; filename="${result.salarySlip.fileName}"`);
		res.send(result.pdfBuffer);
	} catch (err) {
		next(err);
	}
});

app.post('/employees/:empid/mobile', (req, res, next) => {
	try {
		const empid = String(req.params.empid || '').trim();
		if (!empid) {
			throw boom.badRequest('empid is required in the URL');
		}

		const raw = req.body?.mobileNo ?? req.body?.mobile;
		const str = typeof raw === 'string' ? raw : (raw != null ? String(raw) : '');
		const digits = str.replace(/[^0-9]/g, '');

		if (!digits) {
			throw boom.badRequest('mobile number is required');
		}

		if (digits.length < 8 || digits.length > 15) {
			throw boom.badRequest('mobile number must be 8-15 digits');
		}

		const updated = dataStore.updateEmployeeMobile(empid, digits);

		res.json({
			empid: empid,
			name: updated.employee.name ?? '',
			mobile: updated.employee.mobileNo ?? null,
			salarySlipAvailable: updated.salarySlipAvailable,
			message: 'mobile number updated',
		});
	} catch (err) {
		next(err);
	}
});

app.post('/send-salary-slip', async (req, res, next) => {
	try {
		const empid = typeof req.body.empid === 'string' ? req.body.empid.trim() : null;

		if (!empid) {
			throw boom.badRequest('empid is required in the request body');
		}

		const record = dataStore.getEmployee(empid);

		if (!record) {
			throw boom.notFound('Employee not found');
		}

		if (!record.employee.mobileNo) {
			throw boom.badRequest('Employee does not have a mobile number');
		}

		if (!record.salarySlip) {
			throw boom.notFound('Salary slip not available for this employee');
		}

		const caption = `Dear ${record.employee.name || empid},\n\nPlease find attached your salary slip.\n\nRegards,\nSobha HR`;

		await messageService.sendDocument({
			to: record.employee.mobileNo,
			filePath: record.salarySlip.absolutePath,
			fileName: record.salarySlip.fileName,
			caption: caption,
		});

		res.json({
			success: true,
			empid: empid,
			name: record.employee.name ?? '',
			mobile: record.employee.mobileNo,
			message: 'Salary slip sent via WhatsApp',
		});
	} catch (err) {
		next(err);
	}
});

app.get('/whatsapp/status', (req, res) => {
	const status = whatsappConnection.getStatus();
	res.json(status);
});

app.post('/whatsapp/disconnect', async (req, res, next) => {
	try {
		await whatsappConnection.disconnect();
		res.json({ message: 'WhatsApp disconnected' });
	} catch (err) {
		next(err);
	}
});

app.post('/whatsapp/logout-and-reconnect', async (req, res, next) => {
	try {
		const result = await whatsappConnection.logoutAndReconnect();
		const status = whatsappConnection.getStatus();
		res.json({
			...result,
			status: status,
		});
	} catch (err) {
		next(err);
	}
});

// Sync current local store to Excel (one-click export)
app.post('/employees/sync-to-excel', (req, res, next) => {
	try {
		const result = dataStore.syncToExcel();
		res.json({ success: true, ...result, message: 'Excel updated from local store' });
	} catch (err) {
		next(err);
	}
});

// Reload local store from Excel (overwrite local cache)
app.post('/employees/reload-from-excel', (req, res, next) => {
	try {
		const result = dataStore.reloadFromExcel();
		res.json({ success: true, ...result, message: 'Local store reloaded from Excel' });
	} catch (err) {
		next(err);
	}
});

app.use((req, res, next) => {
	next(boom.notFound('Route not found'));
});

app.use((err, req, res, next) => {
	const boomError = boom.isBoom(err) ? err : boom.boomify(err);
	const { output } = boomError;

	logger.error({ err: boomError }, 'request failed');

	res.status(output.statusCode).set(output.headers).json(output.payload);
});

async function start() {
	try {
		await dataStore.initialize();
		await whatsappConnection.connect();
		app.listen(port, () => {
			logger.info({ port }, 'server listening');
		});
	} catch (err) {
		logger.error({ err }, 'failed to initialize application');
		process.exit(1);
	}
}

start();
