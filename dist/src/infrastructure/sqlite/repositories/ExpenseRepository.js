"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseRepository = void 0;
const connection_1 = require("../connection");
class ExpenseRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    listCategories() {
        return this.db.prepare(`
      SELECT id, name FROM expense_categories ORDER BY name ASC
    `).all();
    }
    list() {
        const rows = this.db.prepare(`
      SELECT e.id, e.expense_category_id as expenseCategoryId, c.name as categoryName,
             e.paid_from_account_id as paidFromAccountId, a.name as accountName,
             e.amount, e.recipient, e.notes, e.created_at as createdAt
      FROM expenses e
      LEFT JOIN expense_categories c ON e.expense_category_id = c.id
      LEFT JOIN accounts a ON e.paid_from_account_id = a.id
      ORDER BY e.id DESC
      LIMIT 100
    `).all();
        return rows;
    }
    create(expense) {
        const info = this.db.prepare(`
      INSERT INTO expenses (expense_category_id, paid_from_account_id, amount, recipient, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(expense.expenseCategoryId, expense.paidFromAccountId, expense.amount, expense.recipient || null, expense.notes || null);
        return Number(info.lastInsertRowid);
    }
    getDailyExpenses(dateString) {
        const row = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE date(created_at) = date(?)
    `).get(dateString);
        return row.total;
    }
}
exports.ExpenseRepository = ExpenseRepository;
