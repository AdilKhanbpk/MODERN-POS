"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierRepository = void 0;
const connection_1 = require("../connection");
class SupplierRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    list() {
        const rows = this.db.prepare(`
      SELECT id, supplier_code as supplierCode, name, contact_person as contactPerson,
             phone, email, address, balance, is_active as isActive, created_at as createdAt
      FROM suppliers
      ORDER BY name ASC
    `).all();
        return rows.map(r => ({
            ...r,
            supplierCode: r.supplierCode || `SUP-${r.id.toString().padStart(4, '0')}`,
            isActive: Boolean(r.isActive)
        }));
    }
    findById(id) {
        const row = this.db.prepare(`
      SELECT id, supplier_code as supplierCode, name, contact_person as contactPerson,
             phone, email, address, balance, is_active as isActive, created_at as createdAt
      FROM suppliers
      WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return {
            ...row,
            supplierCode: row.supplierCode || `SUP-${row.id.toString().padStart(4, '0')}`,
            isActive: Boolean(row.isActive)
        };
    }
    search(query) {
        const term = `%${query}%`;
        const rows = this.db.prepare(`
      SELECT id, supplier_code as supplierCode, name, contact_person as contactPerson,
             phone, email, address, balance, is_active as isActive, created_at as createdAt
      FROM suppliers
      WHERE name LIKE ? OR phone LIKE ? OR supplier_code LIKE ?
      ORDER BY name ASC
      LIMIT 25
    `).all(term, term, term);
        return rows.map(r => ({
            ...r,
            supplierCode: r.supplierCode || `SUP-${r.id.toString().padStart(4, '0')}`,
            isActive: Boolean(r.isActive)
        }));
    }
    create(supplier) {
        const code = supplier.supplierCode || `SUP-${Date.now().toString().slice(-4)}`;
        const opening = supplier.openingBalanceMinor || 0;
        const info = this.db.prepare(`
      INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, balance, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(code, supplier.name, supplier.contactPerson || null, supplier.phone, supplier.email || null, supplier.address || null, supplier.isActive !== false ? 1 : 0);
        const supplierId = Number(info.lastInsertRowid);
        if (opening !== 0) {
            // Record dated opening balance ledger entry
            this.addLedgerEntry({
                supplierId,
                entryType: 'OPENING_BALANCE',
                debitMinor: opening < 0 ? Math.abs(opening) : 0,
                creditMinor: opening > 0 ? opening : 0,
                sourceType: 'OPENING_BALANCE',
                sourceId: supplierId,
                notes: 'Initial supplier opening balance'
            });
        }
        return supplierId;
    }
    /**
     * Permanent Supplier Statement: Records an entry in supplier_ledger_entries and
     * updates the supplier's cached balance directly from the authoritative ledger sum.
     */
    addLedgerEntry(entry) {
        const entryType = entry.entryType || entry.transactionType || 'ADJUSTMENT';
        const debit = entry.debitMinor ?? entry.debit ?? 0;
        const credit = entry.creditMinor ?? entry.credit ?? 0;
        const srcType = entry.sourceType || 'MANUAL';
        const srcId = entry.sourceId || entry.referenceId;
        const info = this.db.prepare(`
      INSERT INTO supplier_ledger_entries (
        supplier_id, entry_type, debit_minor, credit_minor, source_type, source_id, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.supplierId, entryType, debit, credit, srcType, srcId || null, entry.notes || null);
        // Calculate authoritative balance directly from ledger sum (Credit - Debit)
        const authoritativeBalance = this.calculateLedgerBalance(entry.supplierId);
        // Update supplier cached balance
        this.updateBalance(entry.supplierId, authoritativeBalance);
        // Legacy table write for backward compatibility
        this.db.prepare(`
      INSERT INTO supplier_ledger (supplier_id, transaction_type, reference_id, debit, credit, running_balance, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.supplierId, entryType, srcId || null, debit, credit, authoritativeBalance, entry.notes || null);
        return Number(info.lastInsertRowid);
    }
    /**
     * Authoritative source of truth:
     * Balance = Total Credits (Purchases/Payables) - Total Debits (Payments/Returns)
     */
    calculateLedgerBalance(supplierId) {
        const row = this.db.prepare(`
      SELECT COALESCE(SUM(credit_minor - debit_minor), 0) as balance
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
    `).get(supplierId);
        return row.balance;
    }
    reconcileBalance(supplierId) {
        const supplier = this.findById(supplierId);
        const cached = supplier ? supplier.balance : 0;
        const ledger = this.calculateLedgerBalance(supplierId);
        const discrepancy = cached - ledger;
        return {
            isReconciled: discrepancy === 0,
            cachedBalance: cached,
            ledgerBalance: ledger,
            discrepancy
        };
    }
    updateBalance(supplierId, newBalance) {
        this.db.prepare(`
      UPDATE suppliers SET balance = ? WHERE id = ?
    `).run(newBalance, supplierId);
    }
    getLedger(supplierId) {
        const rows = this.db.prepare(`
      SELECT id, supplier_id as supplierId, entry_type as entryType,
             debit_minor as debitMinor, credit_minor as creditMinor,
             source_type as sourceType, source_id as sourceId, notes,
             created_at as createdAt
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
      ORDER BY id ASC
    `).all(supplierId);
        let running = 0;
        return rows.map(r => {
            running += (r.creditMinor - r.debitMinor);
            return {
                ...r,
                runningBalance: running
            };
        }).reverse();
    }
}
exports.SupplierRepository = SupplierRepository;
