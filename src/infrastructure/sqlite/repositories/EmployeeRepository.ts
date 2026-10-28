import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { Employee, PayrollRun } from '../../../shared/types';

export class EmployeeRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public list(): Employee[] {
    const rows = this.db.prepare(`
      SELECT id, full_name as fullName, phone, designation, base_salary as baseSalary,
             is_active as isActive, created_at as createdAt
      FROM employees
      ORDER BY full_name ASC
    `).all() as any[];

    return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
  }

  public findById(id: number): Employee | null {
    const row = this.db.prepare(`
      SELECT id, full_name as fullName, phone, designation, base_salary as baseSalary,
             is_active as isActive, created_at as createdAt
      FROM employees
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;
    return { ...row, isActive: Boolean(row.isActive) };
  }

  public create(employee: {
    fullName: string;
    phone: string;
    designation: string;
    baseSalary: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO employees (full_name, phone, designation, base_salary, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(employee.fullName, employee.phone, employee.designation, employee.baseSalary);

    return Number(info.lastInsertRowid);
  }

  public recordPayrollRun(payroll: {
    employeeId: number;
    month: string;
    baseSalary: number;
    allowance: number;
    deduction: number;
    netPayable: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO payroll_runs (employee_id, month, base_salary, allowance, deduction, net_payable, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PAID')
    `).run(
      payroll.employeeId,
      payroll.month,
      payroll.baseSalary,
      payroll.allowance,
      payroll.deduction,
      payroll.netPayable
    );

    return Number(info.lastInsertRowid);
  }

  public listPayrollRuns(): PayrollRun[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.employee_id as employeeId, e.full_name as employeeName, p.month,
             p.base_salary as baseSalary, p.allowance, p.deduction, p.net_payable as netPayable,
             p.status, p.payment_date as paymentDate, p.created_at as createdAt
      FROM payroll_runs p
      LEFT JOIN employees e ON p.employee_id = e.id
      ORDER BY p.id DESC
      LIMIT 100
    `).all() as any[];

    return rows;
  }
}

