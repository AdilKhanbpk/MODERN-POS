import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { Account, JournalEntry, JournalEntryLine } from '../../../shared/types';
import { AccountType } from '../../../shared/constants/accounts';

export class AccountRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public list(): Account[] {
    const rows = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE is_active = 1
      ORDER BY code ASC
    `).all() as any[];

    return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
  }

  public findByCode(code: string): Account | null {
    const row = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE code = ?
    `).get(code) as any;

    if (!row) return null;
    return { ...row, isActive: Boolean(row.isActive) };
  }

  public findById(id: number): Account | null {
    const row = this.db.prepare(`
      SELECT id, code, name, type, balance, is_active as isActive
      FROM accounts
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;
    return { ...row, isActive: Boolean(row.isActive) };
  }

  public updateBalance(accountId: number, newBalance: number): void {
    this.db.prepare(`
      UPDATE accounts SET balance = ? WHERE id = ?
    `).run(newBalance, accountId);
  }

  public createJournalEntry(entry: {
    entryNumber: string;
    referenceType: string;
    referenceId?: number;
    description: string;
    totalAmount: number;
    lines: JournalEntryLine[];
  }): number {
    const info = this.db.prepare(`
      INSERT INTO journal_entries (entry_number, reference_type, reference_id, description, total_amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      entry.entryNumber,
      entry.referenceType,
      entry.referenceId || null,
      entry.description,
      entry.totalAmount
    );

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

  public listJournalEntries(limit = 100): JournalEntry[] {
    const rows = this.db.prepare(`
      SELECT id, entry_number as entryNumber, reference_type as referenceType,
             reference_id as referenceId, description, total_amount as totalAmount,
             created_at as createdAt
      FROM journal_entries
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(r => {
      const lines = this.db.prepare(`
        SELECT l.id, l.journal_entry_id as journalEntryId, l.account_id as accountId,
               a.code as accountCode, a.name as accountName, l.debit, l.credit, l.memo
        FROM journal_entry_lines l
        LEFT JOIN accounts a ON l.account_id = a.id
        WHERE l.journal_entry_id = ?
      `).all(r.id) as JournalEntryLine[];

      return {
        ...r,
        lines
      };
    });
  }

  public getTrialBalance(): Array<{ code: string; name: string; type: AccountType; debit: number; credit: number }> {
    const accounts = this.list();
    return accounts.map(acc => {
      const isDebitNormal = acc.type === AccountType.ASSET || acc.type === AccountType.EXPENSE;
      let debit = 0;
      let credit = 0;

      if (isDebitNormal) {
        if (acc.balance >= 0) {
          debit = acc.balance;
        } else {
          credit = Math.abs(acc.balance);
        }
      } else {
        if (acc.balance >= 0) {
          credit = acc.balance;
        } else {
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

