const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  rootDir: ROOT_DIR,
  salarySlipDir: path.join(ROOT_DIR, 'salary-pdf'),
  employeeWorkbookPath: path.join(ROOT_DIR, 'employees.xlsx'),
  // Local snapshot for fast updates
  localEmployeeSnapshotPath: path.join(ROOT_DIR, 'data', 'employees.json'),
  pdfFilePattern: /^(?<empid>[A-Za-z0-9_-]+)_salaryslip\.pdf$/i,
};
