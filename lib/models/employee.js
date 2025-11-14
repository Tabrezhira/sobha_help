class Employee {
  constructor({ empid, name, mobileNo }) {
    this.empid = empid;
    this.name = name;

    if (mobileNo !== undefined) {
      this.mobileNo = mobileNo;
    }
  }
}

module.exports = Employee;
