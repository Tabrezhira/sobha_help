const fs = require('fs');
const path = require('path');
const Employee = require('../models/employee');

class LocalEmployeeStore {
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.employees = new Map();
    this._snapshotTimeout = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const json = JSON.parse(raw || '[]');
        this.employees.clear();
        for (const row of json) {
          const emp = new Employee({ empid: row.empid, name: row.name, mobileNo: row.mobileNo });
          this.employees.set(emp.empid, emp);
        }
        this.logger?.info({ count: this.employees.size, path: this.filePath }, 'local employee store loaded');
      } else {
        this._ensureDir();
        fs.writeFileSync(this.filePath, '[]', 'utf-8');
        this.logger?.info({ path: this.filePath }, 'local employee store initialized');
      }
    } catch (err) {
      this.logger?.error({ err }, 'failed to load local employee store');
      throw err;
    }
  }

  importFromArray(rows) {
    this.employees.clear();
    for (const r of rows) {
      const emp = new Employee({ empid: r.empid, name: r.name, mobileNo: r.mobileNo });
      this.employees.set(emp.empid, emp);
    }
    this.scheduleSnapshot();
  }

  getAll() {
    return Array.from(this.employees.values());
  }

  getById(empid) {
    return this.employees.get(empid) || null;
  }

  upsertMobile(empid, mobileNo) {
    const id = String(empid).trim();
    const mobile = mobileNo != null ? String(mobileNo).trim() : undefined;
    if (!id) throw new Error('empid is required');

    let emp = this.employees.get(id);
    if (!emp) {
      emp = new Employee({ empid: id });
      this.employees.set(id, emp);
    }
    if (mobile !== undefined) {
      emp.mobileNo = mobile;
    }
    this.scheduleSnapshot();
    return emp;
  }

  scheduleSnapshot() {
    if (this._snapshotTimeout) clearTimeout(this._snapshotTimeout);
    this._snapshotTimeout = setTimeout(() => this.saveSnapshot(), 500);
  }

  saveSnapshot() {
    try {
      this._ensureDir();
      const rows = this.getAll().map(e => ({ empid: e.empid, name: e.name ?? '', mobileNo: e.mobileNo ?? '' }));
      fs.writeFileSync(this.filePath, JSON.stringify(rows, null, 2), 'utf-8');
      this.logger?.info({ count: rows.length, path: this.filePath }, 'local employee snapshot saved');
    } catch (err) {
      this.logger?.error({ err }, 'failed to save local employee snapshot');
    }
  }

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = LocalEmployeeStore;
