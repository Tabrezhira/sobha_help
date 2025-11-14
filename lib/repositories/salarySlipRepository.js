const fs = require('fs');
const path = require('path');

class SalarySlipRepository {
  constructor({ directoryPath, filePattern, logger }) {
    this.directoryPath = directoryPath;
    this.filePattern = filePattern;
    this.logger = logger;
    this.index = new Map();
  }

  async load() {
    if (!fs.existsSync(this.directoryPath)) {
      throw new Error(`Salary slip directory not found at ${this.directoryPath}`);
    }

    const entries = await fs.promises.readdir(this.directoryPath, { withFileTypes: true });

    this.index.clear();

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const match = entry.name.match(this.filePattern);

      if (!match?.groups?.empid) {
        this.logger?.warn({ file: entry.name }, 'skipping non-matching salary slip file');
        continue;
      }

      const empid = match.groups.empid;
      const absolutePath = path.join(this.directoryPath, entry.name);

      this.index.set(empid, { fileName: entry.name, absolutePath });
    }

    this.logger?.info({ totalSalarySlips: this.index.size }, 'salary slip repository loaded');
  }

  getByEmpId(empid) {
    return this.index.get(empid) || null;
  }

  getAll() {
    return Array.from(this.index.entries()).map(([empid, meta]) => ({ empid, ...meta }));
  }
}

module.exports = SalarySlipRepository;
