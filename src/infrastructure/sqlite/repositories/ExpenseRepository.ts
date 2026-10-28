import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { Expense } from '../../../shared/types';

export class ExpenseRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public listCategories(): Array<{ id: number; name: string }> {
    return this.db.prepare(`
      SELECT id, name FROM expense_categories ORDER BY name ASC
    `).all() as any[];
  }

  public list(): Expense[] {
    const rows = this.db.prepare(`
      SELECT e.id, e.expense_category_id as expenseCategoryId, c.name as categoryName,
             e.paid_from_account_id as paidFromAccountId, a.name as accountName,
             e.amount, e.recipient, e.notes, e.created_at as createdAt
      FROM expenses e
      LEFT JOIN expense_categories c ON e.expense_category_id = c.id
      LEFT JOIN accounts a ON e.paid_from_account_id = a.id
      ORDER BY e.id DESC
      LIMIT 100
    `).all() as any[];

    return rows;
  }

  public create(expense: {
    expenseCategoryId: number;
    paidFromAccountId: number;
    amount: number;
    recipient?: string;
    notes?: string;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO expenses (expense_category_id, paid_from_account_id, amount, recipient, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      expense.expenseCategoryId,
      expense.paidFromAccountId,
      expense.amount,
      expense.recipient || null,
      expense.notes || null
    );

    return Number(info.lastInsertRowid);
  }

  public getDailyExpenses(dateString: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE date(created_at) = date(?)
    `).get(dateString) as { total: number };

    return row.total;
  }
}

