const fs = require('fs');
const xlsx = require('xlsx');
const LocalEmployeeStore = require('../repositories/localEmployeeStore');
const config = require('../config');

class DataStore {
  constructor({ employeeRepository, salarySlipRepository, logger }) {
    // employeeRepository reads/writes Excel. We'll use it for import/export only.
    this.employeeRepository = employeeRepository;
    this.salarySlipRepository = salarySlipRepository;
    this.localStore = new LocalEmployeeStore({ filePath: config.localEmployeeSnapshotPath, logger });
    this.logger = logger;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    // Load Excel then hydrate local store for fast access
    this.employeeRepository.load();
    this.localStore.load();

    // If local store is empty but Excel has data, import once
    if (this.localStore.getAll().length === 0) {
      const rows = this.employeeRepository.getAll().map(e => ({ empid: e.empid, name: e.name, mobileNo: e.mobileNo }));
      this.localStore.importFromArray(rows);
      this.logger?.info({ imported: rows.length }, 'hydrated local store from excel');
    }
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

    const employee = this.localStore.getById(empid);

    if (!employee) {
      return null;
    }

    const salarySlip = this.salarySlipRepository.getByEmpId(empid);

    return { employee, salarySlip };
  }

  listEmployees() {
    this.ensureInitialized();

    return this.localStore.getAll().map((employee) => {
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

    const updated = this.localStore.upsertMobile(empid, mobileNo);

    const salarySlip = this.salarySlipRepository.getByEmpId(updated.empid);
    return { employee: updated, salarySlipAvailable: Boolean(salarySlip) };
  }

  // Export local store to Excel on demand
  syncToExcel() {
    this.ensureInitialized();
    const rows = this.localStore.getAll().map(e => ({ empid: e.empid, name: e.name ?? '', mobileNo: e.mobileNo ?? '' }));

    // Keep stable order
    rows.sort((a, b) => String(a.empid).localeCompare(String(b.empid)));

    const worksheet = xlsx.utils.json_to_sheet(rows, { header: ['empid', 'name', 'mobileNo'] });
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Employees');
    xlsx.writeFile(workbook, this.employeeRepository.workbookPath);
    this.logger?.info({ count: rows.length, path: this.employeeRepository.workbookPath }, 'excel synced from local store');

    return { count: rows.length, path: this.employeeRepository.workbookPath };
  }

  // Re-import Excel (overwrite local store)
  reloadFromExcel() {
    this.ensureInitialized();
    this.employeeRepository.load();
    const rows = this.employeeRepository.getAll().map(e => ({ empid: e.empid, name: e.name, mobileNo: e.mobileNo }));
    this.localStore.importFromArray(rows);
    return { imported: rows.length };
  }
}

module.exports = DataStore;
