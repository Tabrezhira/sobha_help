const fs = require('fs');
const xlsx = require('xlsx');
const Employee = require('../models/employee');

class EmployeeRepository {
  constructor({ workbookPath, logger }) {
    this.workbookPath = workbookPath;
    this.logger = logger;
    this.employees = new Map();
  }

  load() {
    if (!fs.existsSync(this.workbookPath)) {
      this.logger?.warn({ workbookPath: this.workbookPath }, 'employee workbook not found; continuing with empty repository');
      this.employees.clear();
      return;
    }

    const workbook = xlsx.readFile(this.workbookPath, { cellDates: false, cellNF: false, cellText: false });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      this.logger?.warn('employee workbook does not contain any sheets; continuing with empty repository');
      this.employees.clear();
      return;
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null });

    this.employees.clear();

    for (const row of rows) {
      const keyMap = this._normalizeRowKeys(row);

      const empid = this.normalizeValue(this._getFirst(keyMap, [
        'empid', 'employeeid', 'employee_code', 'employeecode', 'empcode', 'id', 'code'
      ]));

      const name = this.normalizeValue(this._getFirst(keyMap, [
        'name', 'employeename', 'empname', 'fullname', 'full_name'
      ]));

      const mobileNo = this.normalizeValue(this._getFirst(keyMap, [
        'mobileno', 'mobile', 'mobilenumber', 'phone', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'mobile_no', 'phone_no'
      ]));

      if (!empid) {
        this.logger?.warn({ row }, 'skipping row without empid');
        continue;
      }

      const employee = new Employee({ empid, name, mobileNo });
      this.employees.set(empid, employee);
    }

    this.logger?.info({ totalEmployees: this.employees.size }, 'employee repository loaded');
  }

  normalizeValue(value) {
    if (value === undefined || value === null) {
      return undefined;
    }

    const stringValue = typeof value === 'string' ? value.trim() : String(value).trim();

    if (!stringValue) {
      return undefined;
    }

    return stringValue;
  }

  upsertMobile(empid, mobileNo) {
    const id = this.normalizeValue(empid);
    if (!id) {
      throw new Error('empid is required');
    }

    const mobile = this.normalizeValue(mobileNo);
    let employee = this.employees.get(id);

    if (!employee) {
      employee = new Employee({ empid: id, mobileNo: mobile });
      this.employees.set(id, employee);
    } else {
      if (mobile !== undefined) {
        employee.mobileNo = mobile;
      } else {
        delete employee.mobileNo;
      }
    }

    return employee;
  }

  save() {
    const rows = Array.from(this.employees.values()).map((e) => ({
      empid: e.empid,
      name: e.name ?? '',
      mobileNo: e.mobileNo ?? '',
    }));

    // Keep a stable order for deterministic files
    rows.sort((a, b) => String(a.empid).localeCompare(String(b.empid)));

    const worksheet = xlsx.utils.json_to_sheet(rows, { header: ['empid', 'name', 'mobileNo'] });
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Employees');
    xlsx.writeFile(workbook, this.workbookPath);

    this.logger?.info({ count: rows.length, path: this.workbookPath }, 'employee workbook saved');
  }

  _normalizeRowKeys(row) {
    const map = {};
    for (const key of Object.keys(row)) {
      const norm = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      map[norm] = row[key];
    }
    return map;
  }

  _getFirst(map, keys) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        return map[k];
      }
    }
    return undefined;
  }

  getById(empid) {
    return this.employees.get(empid) || null;
  }

  getAll() {
    return Array.from(this.employees.values());
  }
}

module.exports = EmployeeRepository;
