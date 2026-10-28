import { EmployeeRepository } from '../../infrastructure/sqlite/repositories/EmployeeRepository';
import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { Employee, PayrollRun } from '../../shared/types';
import { StandardAccountCode } from '../../shared/constants/accounts';

export class PayrollService {
  constructor(
    private employeeRepo: EmployeeRepository = new EmployeeRepository(),
    private accountRepo: AccountRepository = new AccountRepository()
  ) {}

  public listEmployees(): Employee[] {
    return this.employeeRepo.list();
  }

  public saveEmployee(employee: {
    id?: number;
    fullName: string;
    phone: string;
    designation: string;
    baseSalary: number;
  }): number {
    return this.employeeRepo.create(employee);
  }

  public runPayroll(params: {
    employeeId: number;
    month: string;
    allowance: number;
    deduction: number;
  }): number {
    const emp = this.employeeRepo.findById(params.employeeId);
    if (!emp) throw new Error('Employee not found');

    const netPayable = emp.baseSalary + params.allowance - params.deduction;
    if (netPayable < 0) throw new Error('Net payable salary cannot be negative');

    return TransactionRunner.run(() => {
      const payrollId = this.employeeRepo.recordPayrollRun({
        employeeId: emp.id,
        month: params.month,
        baseSalary: emp.baseSalary,
        allowance: params.allowance,
        deduction: params.deduction,
        netPayable
      });

      // Post Double Entry: Debit Salary Expense, Credit Cash
      const salaryExpAcc = this.accountRepo.findByCode(StandardAccountCode.SALARY_EXPENSE);
      const cashAcc = this.accountRepo.findByCode(StandardAccountCode.CASH_ON_HAND);

      if (salaryExpAcc && cashAcc) {
        const lines = [
          { accountId: salaryExpAcc.id, debit: netPayable, credit: 0, memo: `Salary for ${emp.fullName} (${params.month})` },
          { accountId: cashAcc.id, debit: 0, credit: netPayable, memo: `Cash disbursed to ${emp.fullName}` }
        ];

        this.accountRepo.createJournalEntry({
          entryNumber: `JE-PAY-${params.month}-${emp.id}`,
          referenceType: 'PAYROLL',
          referenceId: payrollId,
          description: `Salary payout: ${emp.fullName}`,
          totalAmount: netPayable,
          lines
        });

        this.accountRepo.updateBalance(salaryExpAcc.id, DoubleEntryLedger.computeAccountBalance(salaryExpAcc.balance, salaryExpAcc.type, netPayable, 0));
        this.accountRepo.updateBalance(cashAcc.id, DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, 0, netPayable));
      }

      return payrollId;
    });
  }

  public listPayrollHistory(): PayrollRun[] {
    return this.employeeRepo.listPayrollRuns();
  }
}

