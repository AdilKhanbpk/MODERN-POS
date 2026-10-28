import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { Customer, CustomerLedgerEntry } from '../../../shared/types';
import { ICustomerRepository } from '../../../shared/interfaces/repositories/ICustomerRepository';

export class CustomerRepository implements ICustomerRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public list(): Customer[] {
    const rows = this.db.prepare(`
      SELECT id, customer_code as customerCode, name, phone, email, address,
             balance, credit_limit as creditLimit, credit_limit_minor as creditLimitMinor,
             is_active as isActive, created_at as createdAt
      FROM customers
      ORDER BY name ASC
    `).all() as any[];

    return rows.map(r => ({
      ...r,
      customerCode: r.customerCode || `CUST-${r.id.toString().padStart(4, '0')}`,
      isActive: Boolean(r.isActive)
    }));
  }

  public findById(id: number): Customer | null {
    const row = this.db.prepare(`
      SELECT id, customer_code as customerCode, name, phone, email, address,
             balance, credit_limit as creditLimit, credit_limit_minor as creditLimitMinor,
             is_active as isActive, created_at as createdAt
      FROM customers
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;
    return {
      ...row,
      customerCode: row.customerCode || `CUST-${row.id.toString().padStart(4, '0')}`,
      isActive: Boolean(row.isActive)
    };
  }

  public search(query: string): Customer[] {
    const term = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT id, customer_code as customerCode, name, phone, email, address,
             balance, credit_limit as creditLimit, credit_limit_minor as creditLimitMinor,
             is_active as isActive, created_at as createdAt
      FROM customers
      WHERE name LIKE ? OR phone LIKE ? OR customer_code LIKE ?
      ORDER BY name ASC
      LIMIT 25
    `).all(term, term, term) as any[];

    return rows.map(r => ({
      ...r,
      customerCode: r.customerCode || `CUST-${r.id.toString().padStart(4, '0')}`,
      isActive: Boolean(r.isActive)
    }));
  }

  /**
   * Creates customer. If openingBalanceMinor is provided, it is recorded strictly as a dated
   * ledger entry (OPENING_BALANCE) and the balance column matches it, avoiding double-counting!
   */
  public create(customer: {
    customerCode?: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    creditLimitMinor?: number;
    creditLimit?: number;
    openingBalanceMinor?: number;
    isActive?: boolean;
  }): number {
    const code = customer.customerCode || `CUST-${Date.now().toString().slice(-4)}`;
    const limit = customer.creditLimitMinor || customer.creditLimit || 0;
    const opening = customer.openingBalanceMinor || 0;

    const info = this.db.prepare(`
      INSERT INTO customers (customer_code, name, phone, email, address, balance, credit_limit, credit_limit_minor, is_active)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      code,
      customer.name,
      customer.phone,
      customer.email || null,
      customer.address || null,
      limit,
      limit,
      customer.isActive !== false ? 1 : 0
    );

    const customerId = Number(info.lastInsertRowid);

    if (opening !== 0) {
      // Record dated opening balance ledger entry
      this.addLedgerEntry({
        customerId,
        entryType: 'OPENING_BALANCE',
        debitMinor: opening > 0 ? opening : 0,
        creditMinor: opening < 0 ? Math.abs(opening) : 0,
        sourceType: 'OPENING_BALANCE',
        sourceId: customerId,
        notes: 'Initial account opening balance'
      });
    }

    return customerId;
  }

  /**
   * Permanent Customer Statement: Records an entry in customer_ledger_entries and
   * updates the customer's cached balance directly from the authoritative ledger sum.
   */
  public addLedgerEntry(entry: {
    customerId: number;
    entryType?: 'OPENING_BALANCE' | 'SALE_INVOICE' | 'PAYMENT_RECEIVED' | 'SALE_RETURN' | 'ADJUSTMENT' | string;
    transactionType?: string;
    debitMinor?: number;
    debit?: number;
    creditMinor?: number;
    credit?: number;
    runningBalance?: number;
    sourceType?: string;
    sourceId?: number;
    referenceId?: number;
    notes?: string;
  }): number {
    const entryType = entry.entryType || entry.transactionType || 'ADJUSTMENT';
    const debit = entry.debitMinor ?? entry.debit ?? 0;
    const credit = entry.creditMinor ?? entry.credit ?? 0;
    const srcType = entry.sourceType || 'MANUAL';
    const srcId = entry.sourceId || entry.referenceId;

    const info = this.db.prepare(`
      INSERT INTO customer_ledger_entries (
        customer_id, entry_type, debit_minor, credit_minor, source_type, source_id, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.customerId,
      entryType,
      debit,
      credit,
      srcType,
      srcId || null,
      entry.notes || null
    );

    // Calculate authoritative balance directly from ledger sum
    const authoritativeBalance = this.calculateLedgerBalance(entry.customerId);

    // Update customer cached balance
    this.updateBalance(entry.customerId, authoritativeBalance);

    // Also write to legacy customer_ledger for backwards compatibility if table exists
    this.db.prepare(`
      INSERT INTO customer_ledger (customer_id, transaction_type, reference_id, debit, credit, running_balance, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.customerId,
      entryType,
      srcId || null,
      debit,
      credit,
      authoritativeBalance,
      entry.notes || null
    );

    return Number(info.lastInsertRowid);
  }

  /**
   * Authoritative source of truth:
   * Balance = Total Debits (Receivables) - Total Credits (Payments/Returns)
   */
  public calculateLedgerBalance(customerId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(debit_minor - credit_minor), 0) as balance
      FROM customer_ledger_entries
      WHERE customer_id = ?
    `).get(customerId) as { balance: number };

    return row.balance;
  }

  public reconcileBalance(customerId: number): { isReconciled: boolean; cachedBalance: number; ledgerBalance: number; discrepancy: number } {
    const customer = this.findById(customerId);
    const cached = customer ? customer.balance : 0;
    const ledger = this.calculateLedgerBalance(customerId);
    const discrepancy = cached - ledger;

    return {
      isReconciled: discrepancy === 0,
      cachedBalance: cached,
      ledgerBalance: ledger,
      discrepancy
    };
  }

  public updateBalance(customerId: number, newBalance: number): void {
    this.db.prepare(`
      UPDATE customers SET balance = ? WHERE id = ?
    `).run(newBalance, customerId);
  }

  public getLedger(customerId: number): CustomerLedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT id, customer_id as customerId, entry_type as entryType,
             debit_minor as debitMinor, credit_minor as creditMinor,
             source_type as sourceType, source_id as sourceId, notes,
             created_at as createdAt
      FROM customer_ledger_entries
      WHERE customer_id = ?
      ORDER BY id ASC
    `).all(customerId) as any[];

    // Calculate running balances
    let running = 0;
    return rows.map(r => {
      running += (r.debitMinor - r.creditMinor);
      return {
        ...r,
        runningBalance: running
      };
    }).reverse();
  }
}
