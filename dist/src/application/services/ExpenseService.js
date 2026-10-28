"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseService = void 0;
const ExpenseRepository_1 = require("../../infrastructure/sqlite/repositories/ExpenseRepository");
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const double_entry_1 = require("../../domain/accounting/double-entry");
const accounts_1 = require("../../shared/constants/accounts");
class ExpenseService {
    expenseRepo;
    accountRepo;
    constructor(expenseRepo = new ExpenseRepository_1.ExpenseRepository(), accountRepo = new AccountRepository_1.AccountRepository()) {
        this.expenseRepo = expenseRepo;
        this.accountRepo = accountRepo;
    }
    listCategories() {
        return this.expenseRepo.listCategories();
    }
    listExpenses() {
        return this.expenseRepo.list();
    }
    createExpense(params) {
        if (params.amount <= 0)
            throw new Error('Expense amount must be positive');
        return transaction_runner_1.TransactionRunner.run(() => {
            const expenseId = this.expenseRepo.create(params);
            // Post Double-Entry Journal: Debit General Expense, Credit Cash/Bank
            const generalExpenseAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.GENERAL_EXPENSE);
            const paidFromAcc = this.accountRepo.findById(params.paidFromAccountId);
            if (generalExpenseAcc && paidFromAcc) {
                const lines = [
                    { accountId: generalExpenseAcc.id, debit: params.amount, credit: 0, memo: params.notes || 'Operating expense' },
                    { accountId: paidFromAcc.id, debit: 0, credit: params.amount, memo: `Disbursement to ${params.recipient || 'N/A'}` }
                ];
                this.accountRepo.createJournalEntry({
                    entryNumber: `JE-EXP-${Date.now()}`,
                    referenceType: 'EXPENSE',
                    referenceId: expenseId,
                    description: `Expense: ${params.notes || 'Operating Cost'}`,
                    totalAmount: params.amount,
                    lines
                });
                this.accountRepo.updateBalance(generalExpenseAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(generalExpenseAcc.balance, generalExpenseAcc.type, params.amount, 0));
                this.accountRepo.updateBalance(paidFromAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(paidFromAcc.balance, paidFromAcc.type, 0, params.amount));
            }
            return expenseId;
        });
    }
}
exports.ExpenseService = ExpenseService;
