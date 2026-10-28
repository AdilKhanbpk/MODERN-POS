"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeRepository = void 0;
const connection_1 = require("../connection");
class EmployeeRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    list() {
        const rows = this.db.prepare(`
      SELECT id, full_name as fullName, phone, designation, base_salary as baseSalary,
             is_active as isActive, created_at as createdAt
      FROM employees
      ORDER BY full_name ASC
    `).all();
        return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
    }
    findById(id) {
        const row = this.db.prepare(`
      SELECT id, full_name as fullName, phone, designation, base_salary as baseSalary,
             is_active as isActive, created_at as createdAt
      FROM employees
      WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return { ...row, isActive: Boolean(row.isActive) };
    }
    create(employee) {
        const info = this.db.prepare(`
      INSERT INTO employees (full_name, phone, designation, base_salary, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(employee.fullName, employee.phone, employee.designation, employee.baseSalary);
        return Number(info.lastInsertRowid);
    }
    recordPayrollRun(payroll) {
        const info = this.db.prepare(`
      INSERT INTO payroll_runs (employee_id, month, base_salary, allowance, deduction, net_payable, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PAID')
    `).run(payroll.employeeId, payroll.month, payroll.baseSalary, payroll.allowance, payroll.deduction, payroll.netPayable);
        return Number(info.lastInsertRowid);
    }
    listPayrollRuns() {
        const rows = this.db.prepare(`
      SELECT p.id, p.employee_id as employeeId, e.full_name as employeeName, p.month,
             p.base_salary as baseSalary, p.allowance, p.deduction, p.net_payable as netPayable,
             p.status, p.payment_date as paymentDate, p.created_at as createdAt
      FROM payroll_runs p
      LEFT JOIN employees e ON p.employee_id = e.id
      ORDER BY p.id DESC
      LIMIT 100
    `).all();
        return rows;
    }
}
exports.EmployeeRepository = EmployeeRepository;
