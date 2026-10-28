"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountRepository = void 0;
const connection_1 = require("../connection");
const accounts_1 = require("../../../shared/constants/accounts");
class AccountRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    list() {
        const rows = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE is_active = 1
      ORDER BY code ASC
    `).all();
        return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
    }
    findByCode(code) {
        const row = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE code = ?
    `).get(code);
        if (!row)
            return null;
        return { ...row, isActive: Boolean(row.isActive) };
    }
    findById(id) {
        const row = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return { ...row, isActive: Boolean(row.isActive) };
    }
    updateBalance(accountId, newBalance) {
        this.db.prepare(`
      UPDATE accounts SET balance = ? WHERE id = ?
    `).run(newBalance, accountId);
    }
    createJournalEntry(entry) {
        const info = this.db.prepare(`
      INSERT INTO journal_entries (entry_number, reference_type, reference_id, description, total_amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.entryNumber, entry.referenceType, entry.referenceId || null, entry.description, entry.totalAmount);
        const entryId = Number(info.lastInsertRowid);
        const insertLine = this.db.prepare(`
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      VALUES (?, ?, ?, ?, ?)
    `);
        for (const line of entry.lines) {
            insertLine.run(entryId, line.accountId, line.debit, line.credit, line.memo || null);
        }
        return entryId;
    }
    listJournalEntries(limit = 100) {
        const rows = this.db.prepare(`
      SELECT id, entry_number as entryNumber, reference_type as referenceType,
             reference_id as referenceId, description, total_amount as totalAmount,
             created_at as createdAt
      FROM journal_entries
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
        return rows.map(r => {
            const lines = this.db.prepare(`
        SELECT l.id, l.journal_entry_id as journalEntryId, l.account_id as accountId,
               a.code as accountCode, a.name as accountName, l.debit, l.credit, l.memo
        FROM journal_entry_lines l
        LEFT JOIN accounts a ON l.account_id = a.id
        WHERE l.journal_entry_id = ?
      `).all(r.id);
            return {
                ...r,
                lines
            };
        });
    }
    getTrialBalance() {
        const accounts = this.list();
        return accounts.map(acc => {
            const isDebitNormal = acc.type === accounts_1.AccountType.ASSET || acc.type === accounts_1.AccountType.EXPENSE;
            let debit = 0;
            let credit = 0;
            if (isDebitNormal) {
                if (acc.balance >= 0) {
                    debit = acc.balance;
                }
                else {
                    credit = Math.abs(acc.balance);
                }
            }
            else {
                if (acc.balance >= 0) {
                    credit = acc.balance;
                }
                else {
                    debit = Math.abs(acc.balance);
                }
            }
            return {
                code: acc.code,
                name: acc.name,
                type: acc.type,
                debit,
                credit
            };
        });
    }
}
exports.AccountRepository = AccountRepository;
