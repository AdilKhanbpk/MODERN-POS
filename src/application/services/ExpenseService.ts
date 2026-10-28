import { ExpenseRepository } from '../../infrastructure/sqlite/repositories/ExpenseRepository';
import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { Expense } from '../../shared/types';
import { StandardAccountCode } from '../../shared/constants/accounts';

export class ExpenseService {
  constructor(
    private expenseRepo: ExpenseRepository = new ExpenseRepository(),
    private accountRepo: AccountRepository = new AccountRepository()
  ) {}

  public listCategories(): Array<{ id: number; name: string }> {
    return this.expenseRepo.listCategories();
  }

  public listExpenses(): Expense[] {
    return this.expenseRepo.list();
  }

  public createExpense(params: {
    expenseCategoryId: number;
    paidFromAccountId: number;
    amount: number;
    recipient?: string;
    notes?: string;
  }): number {
    if (params.amount <= 0) throw new Error('Expense amount must be positive');

    return TransactionRunner.run(() => {
      const expenseId = this.expenseRepo.create(params);

      // Post Double-Entry Journal: Debit General Expense, Credit Cash/Bank
      const generalExpenseAcc = this.accountRepo.findByCode(StandardAccountCode.GENERAL_EXPENSE);
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

        this.accountRepo.updateBalance(generalExpenseAcc.id, DoubleEntryLedger.computeAccountBalance(generalExpenseAcc.balance, generalExpenseAcc.type, params.amount, 0));
        this.accountRepo.updateBalance(paidFromAcc.id, DoubleEntryLedger.computeAccountBalance(paidFromAcc.balance, paidFromAcc.type, 0, params.amount));
      }

      return expenseId;
    });
  }
}

