const fs = require('fs');

class DataStore {
  constructor({ employeeRepository, salarySlipRepository, logger }) {
    this.employeeRepository = employeeRepository;
    this.salarySlipRepository = salarySlipRepository;
    this.logger = logger;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.employeeRepository.load();
    await this.salarySlipRepository.load();

    this.initialized = true;
    this.logger?.info('data store initialized');
  }

  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Data store not initialized. Call initialize() before using the store.');
    }
  }

  getEmployee(empid) {
    this.ensureInitialized();

    const employee = this.employeeRepository.getById(empid);

    if (!employee) {
      return null;
    }

    const salarySlip = this.salarySlipRepository.getByEmpId(empid);

    return { employee, salarySlip };
  }

  listEmployees() {
    this.ensureInitialized();

    return this.employeeRepository.getAll().map((employee) => {
      const salarySlip = this.salarySlipRepository.getByEmpId(employee.empid);

      return { employee, salarySlipAvailable: Boolean(salarySlip) };
    });
  }

  async getEmployeeWithSalarySlipContent(empid) {
    const record = this.getEmployee(empid);

    if (!record) {
      return null;
    }

    if (!record.salarySlip) {
      return { employee: record.employee, salarySlip: null, pdfBuffer: null };
    }

    const pdfBuffer = await fs.promises.readFile(record.salarySlip.absolutePath);

    return { employee: record.employee, salarySlip: record.salarySlip, pdfBuffer };
  }

  updateEmployeeMobile(empid, mobileNo) {
    this.ensureInitialized();

    const updated = this.employeeRepository.upsertMobile(empid, mobileNo);
    this.employeeRepository.save();

    const salarySlip = this.salarySlipRepository.getByEmpId(updated.empid);
    return { employee: updated, salarySlipAvailable: Boolean(salarySlip) };
  }
}

module.exports = DataStore;
