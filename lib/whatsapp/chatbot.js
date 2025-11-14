class WhatsAppChatbot {
	constructor({ dataStore, messageService, logger }) {
		this.dataStore = dataStore;
		this.messageService = messageService;
		this.logger = logger;
		// Track conversation state: { phoneNumber: { stage: 'awaiting_empid', data: {} } }
		this.conversations = new Map();
	}

	async handleIncomingMessage(message) {
		try {
			// Only process text messages from users (not groups, not status)
			if (message.key.remoteJid.endsWith('@g.us') || message.key.remoteJid === 'status@broadcast') {
				return;
			}

			// Get message text
			const messageText = message.message?.conversation || 
			                   message.message?.extendedTextMessage?.text || '';
			
			if (!messageText) {
				return;
			}

			const phoneNumber = message.key.remoteJid; // Format: 919825533053@s.whatsapp.net
			const cleanPhone = phoneNumber.replace('@s.whatsapp.net', '');

			this.logger?.info({ phoneNumber: cleanPhone, text: messageText }, 'received message');

			// Check if user typed "sobha" (case insensitive)
			if (messageText.trim().toLowerCase() === 'sobha') {
				await this.handleSobhaCommand(cleanPhone, phoneNumber);
				return;
			}

			// Check if user is in a conversation (waiting for empid)
			const conversation = this.conversations.get(cleanPhone);
			if (conversation && conversation.stage === 'awaiting_empid') {
				await this.handleEmpidResponse(cleanPhone, phoneNumber, messageText.trim());
				return;
			}

		} catch (err) {
			this.logger?.error({ err }, 'error handling incoming message');
		}
	}

	async handleSobhaCommand(cleanPhone, whatsappNumber) {
		try {
			// Search for employee by mobile number
			const employees = this.dataStore.listEmployees();
			const employee = employees.find(emp => {
				if (!emp.employee.mobileNo) return false;
				
				// Normalize phone numbers for comparison
				const empPhone = emp.employee.mobileNo.replace(/^\+/, '');
				const userPhone = cleanPhone.replace(/^\+/, '');
				
				return empPhone === userPhone || empPhone.endsWith(userPhone) || userPhone.endsWith(empPhone);
			});

			if (employee) {
				// Employee found - now check if salary slip exists
				const empid = employee.employee.empid;
				const fullRecord = this.dataStore.getEmployee(empid);
				
				if (fullRecord && fullRecord.salarySlip) {
					// Salary slip found - send it
					await this.sendSalarySlip(fullRecord, whatsappNumber);
					this.conversations.delete(cleanPhone);
				} else {
					// Employee exists but no salary slip
					await this.messageService.sendText({
						to: whatsappNumber,
						text: `Hello ${employee.employee.name || 'there'}! ✋\n\nYour Employee ID: ${empid}\n\nYour salary slip is not available yet. Please contact HR.`
					});
					this.conversations.delete(cleanPhone);
				}
			} else {
				// Employee not found by mobile - ask for empid
				await this.messageService.sendText({
					to: whatsappNumber,
					text: 'Hello! 👋\n\nI don\'t have your mobile number registered.\n\nPlease share your Employee ID to proceed.'
				});
				
				this.conversations.set(cleanPhone, {
					stage: 'awaiting_empid',
					startedAt: Date.now()
				});
			}

		} catch (err) {
			this.logger?.error({ err, phone: cleanPhone }, 'error handling sobha command');
			await this.messageService.sendText({
				to: whatsappNumber,
				text: 'Sorry, something went wrong. Please try again later.'
			});
		}
	}

	async handleEmpidResponse(cleanPhone, whatsappNumber, empid) {
		try {
			// Get employee by empid
			const record = this.dataStore.getEmployee(empid);

			if (!record) {
				await this.messageService.sendText({
					to: whatsappNumber,
					text: `Employee ID "${empid}" not found. ❌\n\nPlease check and send the correct Employee ID.`
				});
				return;
			}

			// Update mobile number
			const updated = this.dataStore.updateEmployeeMobile(empid, cleanPhone);

			await this.messageService.sendText({
				to: whatsappNumber,
				text: `Thank you, ${updated.employee.name || empid}! ✅\n\nYour mobile number has been registered.`
			});

			// Send salary slip if available
			if (updated.salarySlipAvailable && record.salarySlip) {
				await this.sendSalarySlip(record, whatsappNumber);
			} else {
				await this.messageService.sendText({
					to: whatsappNumber,
					text: 'Your salary slip is not available yet. Please contact HR.'
				});
			}

			// Clear conversation
			this.conversations.delete(cleanPhone);

		} catch (err) {
			this.logger?.error({ err, phone: cleanPhone, empid }, 'error handling empid response');
			await this.messageService.sendText({
				to: whatsappNumber,
				text: 'Sorry, something went wrong while processing your Employee ID. Please try again.'
			});
		}
	}

	async sendSalarySlip(employeeRecord, whatsappNumber) {
		try {
			const caption = `Dear ${employeeRecord.employee.name || 'Employee'},\n\nPlease find attached your salary slip. 📄\n\nRegards,\nSobha HR`;

			await this.messageService.sendDocument({
				to: whatsappNumber,
				filePath: employeeRecord.salarySlip.absolutePath,
				fileName: employeeRecord.salarySlip.fileName,
				caption: caption
			});

			this.logger?.info({ 
				empid: employeeRecord.employee.empid, 
				name: employeeRecord.employee.name,
				phone: whatsappNumber 
			}, 'salary slip sent via chatbot');

		} catch (err) {
			this.logger?.error({ err, empid: employeeRecord.employee.empid }, 'error sending salary slip');
			throw err;
		}
	}

	// Clean up old conversations (called periodically)
	cleanupOldConversations(maxAgeMinutes = 30) {
		const now = Date.now();
		const maxAge = maxAgeMinutes * 60 * 1000;

		for (const [phone, conversation] of this.conversations.entries()) {
			if (now - conversation.startedAt > maxAge) {
				this.conversations.delete(phone);
				this.logger?.info({ phone }, 'cleaned up old conversation');
			}
		}
	}
}

module.exports = WhatsAppChatbot;
