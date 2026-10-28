"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayrollService = void 0;
const EmployeeRepository_1 = require("../../infrastructure/sqlite/repositories/EmployeeRepository");
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const double_entry_1 = require("../../domain/accounting/double-entry");
const accounts_1 = require("../../shared/constants/accounts");
class PayrollService {
    employeeRepo;
    accountRepo;
    constructor(employeeRepo = new EmployeeRepository_1.EmployeeRepository(), accountRepo = new AccountRepository_1.AccountRepository()) {
        this.employeeRepo = employeeRepo;
        this.accountRepo = accountRepo;
    }
    listEmployees() {
        return this.employeeRepo.list();
    }
    saveEmployee(employee) {
        return this.employeeRepo.create(employee);
    }
    runPayroll(params) {
        const emp = this.employeeRepo.findById(params.employeeId);
        if (!emp)
            throw new Error('Employee not found');
        const netPayable = emp.baseSalary + params.allowance - params.deduction;
        if (netPayable < 0)
            throw new Error('Net payable salary cannot be negative');
        return transaction_runner_1.TransactionRunner.run(() => {
            const payrollId = this.employeeRepo.recordPayrollRun({
                employeeId: emp.id,
                month: params.month,
                baseSalary: emp.baseSalary,
                allowance: params.allowance,
                deduction: params.deduction,
                netPayable
            });
            // Post Double Entry: Debit Salary Expense, Credit Cash
            const salaryExpAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.SALARY_EXPENSE);
            const cashAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.CASH_ON_HAND);
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
                this.accountRepo.updateBalance(salaryExpAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(salaryExpAcc.balance, salaryExpAcc.type, netPayable, 0));
                this.accountRepo.updateBalance(cashAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, 0, netPayable));
            }
            return payrollId;
        });
    }
    listPayrollHistory() {
        return this.employeeRepo.listPayrollRuns();
    }
}
exports.PayrollService = PayrollService;
