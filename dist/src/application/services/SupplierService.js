"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierService = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../../infrastructure/sqlite/connection");
const supplier_balance_1 = require("../../domain/suppliers/supplier-balance");
class SupplierService {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. SUPPLIER CRUD & DIRECTORY
    // =========================================================================
    /**
     * Create Supplier:
     * - Validates unique (business_id, supplier_code)
     * - Records initial dated opening balance ledger entry if provided
     * - Authoritatively initializes cached balance
     */
    createSupplier(dto, actor) {
        const businessId = dto.businessId || actor?.businessId || '00000000-0000-0000-0000-000000000001';
        const supplierId = (0, crypto_1.randomUUID)();
        const supplierCode = (dto.supplierCode || `SUP-${Date.now().toString().slice(-6)}`).trim();
        const openingBalance = Math.floor(Number(dto.openingBalanceMinor || 0));
        // Check unique (business_id, supplier_code)
        const existing = this.db.prepare(`
      SELECT id FROM suppliers WHERE business_id = ? AND supplier_code = ?
    `).get(businessId, supplierCode);
        if (existing) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier with code '${supplierCode}' already exists in this business.`);
        }
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO suppliers (
          id, business_id, supplier_code, name, contact_person, phone, email,
          address, tax_number, payment_terms_days, credit_limit_minor,
          opening_balance_minor, notes, is_active, balance
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, 0
        )
      `).run(supplierId, businessId, supplierCode, dto.name.trim(), dto.contactPerson || null, dto.phone || null, dto.email || null, dto.address || null, dto.taxNumber || null, Math.max(0, dto.paymentTermsDays || 0), dto.creditLimitMinor ?? null, openingBalance, dto.notes || null, dto.isActive !== false ? 1 : 0);
            // Record opening balance in supplier_ledger_entries
            if (openingBalance !== 0) {
                // In AP: Credit increases payable (we owe supplier), Debit decreases payable (supplier owes us / advance)
                const isCredit = openingBalance > 0;
                const debitMinor = isCredit ? 0 : Math.abs(openingBalance);
                const creditMinor = isCredit ? openingBalance : 0;
                this.recordSupplierLedgerEntry({
                    businessId,
                    branchId: actor?.branchId,
                    supplierId,
                    entryType: 'OPENING_BALANCE',
                    referenceType: 'OPENING_BALANCE',
                    referenceId: supplierId,
                    debitMinor,
                    creditMinor,
                    description: 'Initial supplier opening balance',
                    entryDate: new Date(Date.now() - 1000).toISOString(),
                    createdBy: actor?.userId ? String(actor.userId) : null
                });
            }
        });
        tx();
        return this.getSupplierById(supplierId, businessId);
    }
    /**
     * Update Supplier Profile:
     * Strictly blocks direct manual editing of calculated supplier balance!
     */
    updateSupplier(id, dto, actor) {
        const supplier = this.getSupplierById(id);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${id}' not found.`);
        }
        this.db.prepare(`
      UPDATE suppliers
      SET name = COALESCE(?, name),
          contact_person = COALESCE(?, contact_person),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          address = COALESCE(?, address),
          tax_number = COALESCE(?, tax_number),
          payment_terms_days = COALESCE(?, payment_terms_days),
          credit_limit_minor = COALESCE(?, credit_limit_minor),
          notes = COALESCE(?, notes),
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(dto.name !== undefined ? dto.name.trim() : null, dto.contactPerson !== undefined ? dto.contactPerson : null, dto.phone !== undefined ? dto.phone : null, dto.email !== undefined ? dto.email : null, dto.address !== undefined ? dto.address : null, dto.taxNumber !== undefined ? dto.taxNumber : null, dto.paymentTermsDays !== undefined ? Math.max(0, dto.paymentTermsDays) : null, dto.creditLimitMinor !== undefined ? dto.creditLimitMinor : null, dto.notes !== undefined ? dto.notes : null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, supplier.id);
        return this.getSupplierById(supplier.id);
    }
    /**
     * Get Supplier by ID with authoritative calculated balance
     */
    getSupplierById(id, businessId) {
        let row;
        if (businessId) {
            row = this.db.prepare(`
        SELECT * FROM suppliers WHERE (id = ? OR supplier_code = ?) AND business_id = ?
      `).get(String(id), String(id), businessId);
        }
        else {
            row = this.db.prepare(`
        SELECT * FROM suppliers WHERE id = ? OR supplier_code = ?
      `).get(String(id), String(id));
        }
        if (!row)
            return null;
        const authoritativeBalance = this.calculateLedgerBalance(row.id);
        return {
            id: row.id,
            businessId: row.business_id,
            supplierCode: row.supplier_code,
            name: row.name,
            contactPerson: row.contact_person,
            phone: row.phone,
            email: row.email,
            address: row.address,
            taxNumber: row.tax_number,
            paymentTermsDays: Number(row.payment_terms_days || 0),
            creditLimitMinor: row.credit_limit_minor !== null ? Number(row.credit_limit_minor) : null,
            openingBalanceMinor: Number(row.opening_balance_minor || 0),
            notes: row.notes,
            isActive: Boolean(row.is_active),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            balance: authoritativeBalance,
            creditLimit: row.credit_limit_minor !== null ? Number(row.credit_limit_minor) : undefined
        };
    }
    /**
     * List Suppliers with search and filter support
     */
    listSuppliers(businessId, filter) {
        const bizId = businessId || '00000000-0000-0000-0000-000000000001';
        let sql = `SELECT * FROM suppliers WHERE business_id = ?`;
        const params = [bizId];
        if (filter?.activeOnly) {
            sql += ` AND is_active = 1`;
        }
        if (filter?.query && filter.query.trim()) {
            const q = `%${filter.query.trim()}%`;
            sql += ` AND (name LIKE ? OR supplier_code LIKE ? OR phone LIKE ? OR contact_person LIKE ?)`;
            params.push(q, q, q, q);
        }
        sql += ` ORDER BY name ASC`;
        const rows = this.db.prepare(sql).all(...params);
        const results = rows.map(r => ({
            id: r.id,
            businessId: r.business_id,
            supplierCode: r.supplier_code,
            name: r.name,
            contactPerson: r.contact_person,
            phone: r.phone,
            email: r.email,
            address: r.address,
            taxNumber: r.tax_number,
            paymentTermsDays: Number(r.payment_terms_days || 0),
            creditLimitMinor: r.credit_limit_minor !== null ? Number(r.credit_limit_minor) : null,
            openingBalanceMinor: Number(r.opening_balance_minor || 0),
            notes: r.notes,
            isActive: Boolean(r.is_active),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            balance: this.calculateLedgerBalance(r.id),
            creditLimit: r.credit_limit_minor !== null ? Number(r.credit_limit_minor) : undefined
        }));
        if (filter?.withBalanceOnly) {
            return results.filter(r => r.balance !== 0);
        }
        return results;
    }
    // =========================================================================
    // 2. SUPPLIER LEDGER & BALANCE CALCULATION
    // =========================================================================
    /**
     * Authoritative calculation from posted ledger entries:
     * Balance = Sum(Credit) - Sum(Debit)
     */
    calculateLedgerBalance(supplierId) {
        const row = this.db.prepare(`
      SELECT COALESCE(SUM(credit_minor - debit_minor), 0) as balance
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
    `).get(String(supplierId));
        return Number(row?.balance || 0);
    }
    /**
     * Record an atomic ledger entry and update cached balance
     */
    recordSupplierLedgerEntry(entry) {
        const debit = Math.max(0, Math.floor(entry.debitMinor));
        const credit = Math.max(0, Math.floor(entry.creditMinor));
        if (debit > 0 && credit > 0) {
            throw new supplier_balance_1.SupplierBalanceError('Single ledger entry cannot contain both debit and credit.');
        }
        const entryId = (0, crypto_1.randomUUID)();
        const entryDate = entry.entryDate || new Date().toISOString();
        const currency = entry.currencyCode || 'PKR';
        this.db.prepare(`
      INSERT INTO supplier_ledger_entries (
        id, business_id, branch_id, supplier_id, entry_type, reference_type, reference_id,
        debit_minor, credit_minor, currency_code, description, entry_date, created_by,
        reversal_of_entry_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?
      )
    `).run(entryId, entry.businessId, entry.branchId || null, String(entry.supplierId), entry.entryType, entry.referenceType || null, entry.referenceId || null, debit, credit, currency, entry.description || null, entryDate, entry.createdBy || null, entry.reversalOfEntryId || null);
        // Synchronize cached balance
        const authoritativeBalance = this.calculateLedgerBalance(entry.supplierId);
        this.db.prepare(`
      UPDATE suppliers SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(authoritativeBalance, String(entry.supplierId));
        return entryId;
    }
    // =========================================================================
    // 3. SUPPLIER PAYMENTS & ALLOCATIONS
    // =========================================================================
    /**
     * Record Supplier Payment:
     * - Supports partial payments, multi-purchase allocations, unallocated advance payments
     * - Atomically creates payment record, allocation records, and ledger entry (Debit)
     */
    recordSupplierPayment(dto, actor) {
        const supplier = this.getSupplierById(dto.supplierId, dto.businessId || actor?.businessId);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${dto.supplierId}' not found.`);
        }
        if (!supplier.isActive) {
            throw new supplier_balance_1.InactiveSupplierError(supplier.name);
        }
        const amountMinor = Math.floor(Number(dto.amountMinor));
        if (amountMinor <= 0) {
            throw new supplier_balance_1.SupplierBalanceError('Payment amount must be greater than zero.');
        }
        const businessId = dto.businessId || supplier.businessId || actor?.businessId || '00000000-0000-0000-0000-000000000001';
        const paymentNumber = dto.paymentNumber || `SPAY-${Date.now().toString().slice(-6)}`;
        const paymentId = (0, crypto_1.randomUUID)();
        const paymentDate = dto.paymentDate || new Date().toISOString();
        // Validate allocations against outstanding invoices
        const outstandingInvoices = this.getOutstandingPurchaseInvoices(supplier.id, businessId);
        const validatedAllocations = [];
        let totalAllocated = 0;
        if (dto.allocations && dto.allocations.length > 0) {
            for (const reqAlloc of dto.allocations) {
                const allocMinor = Math.floor(Number(reqAlloc.allocatedMinor));
                if (allocMinor <= 0)
                    continue;
                const inv = outstandingInvoices.find(o => String(o.purchaseId) === String(reqAlloc.purchaseDocumentId));
                const remainingDue = inv ? inv.remainingDueMinor : 0;
                if (allocMinor > remainingDue) {
                    throw new supplier_balance_1.SupplierBalanceError(`Cannot allocate ${allocMinor} to purchase '${reqAlloc.purchaseDocumentId}'; remaining due is only ${remainingDue}.`);
                }
                validatedAllocations.push({
                    purchaseDocumentId: reqAlloc.purchaseDocumentId,
                    allocatedMinor: allocMinor
                });
                totalAllocated += allocMinor;
            }
            if (totalAllocated > amountMinor) {
                throw new supplier_balance_1.SupplierBalanceError(`Total allocated (${totalAllocated}) cannot exceed payment amount (${amountMinor}).`);
            }
        }
        const unallocatedAdvance = amountMinor - totalAllocated;
        const tx = this.db.transaction(() => {
            // 1. Insert supplier_payments record
            this.db.prepare(`
        INSERT INTO supplier_payments (
          id, business_id, branch_id, supplier_id, payment_number, payment_date,
          amount_minor, currency_code, payment_method, cash_account_id, reference_number,
          notes, status, created_by, posted_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, 'POSTED', ?, CURRENT_TIMESTAMP
        )
      `).run(paymentId, businessId, dto.branchId || actor?.branchId || null, supplier.id, paymentNumber, paymentDate, amountMinor, dto.currencyCode || 'PKR', dto.paymentMethod, dto.cashAccountId || null, dto.referenceNumber || null, dto.notes || null, actor?.userId ? String(actor.userId) : null);
            // 2. Insert allocations
            const allocStmt = this.db.prepare(`
        INSERT INTO supplier_payment_allocations (
          id, business_id, supplier_payment_id, purchase_document_id, allocated_minor
        ) VALUES (?, ?, ?, ?, ?)
      `);
            for (const alloc of validatedAllocations) {
                allocStmt.run((0, crypto_1.randomUUID)(), businessId, paymentId, String(alloc.purchaseDocumentId), alloc.allocatedMinor);
            }
            // 3. Post DEBIT entry to supplier_ledger_entries (Payment decreases payable)
            this.recordSupplierLedgerEntry({
                businessId,
                branchId: dto.branchId || actor?.branchId,
                supplierId: supplier.id,
                entryType: 'PAYMENT_DISBURSED',
                referenceType: 'SUPPLIER_PAYMENT',
                referenceId: paymentId,
                debitMinor: amountMinor,
                creditMinor: 0,
                currencyCode: dto.currencyCode || 'PKR',
                description: dto.notes || `Disbursed payment #${paymentNumber} (${dto.paymentMethod})`,
                entryDate: paymentDate,
                createdBy: actor?.userId ? String(actor.userId) : null
            });
        });
        tx();
        const newBalance = this.calculateLedgerBalance(supplier.id);
        return {
            paymentId,
            paymentNumber,
            totalAllocated,
            unallocatedAdvance,
            newBalance
        };
    }
    /**
     * Reverse Supplier Payment:
     * - Marks payment status = 'REVERSED'
     * - Clears allocations
     * - Posts equal & opposite CREDIT entry linking reversal_of_entry_id
     * - Restores original payable balance
     */
    reverseSupplierPayment(paymentId, reason, actor) {
        if (!reason || !reason.trim()) {
            throw new supplier_balance_1.PaymentReversalError('A valid reason must be provided to reverse a supplier payment.');
        }
        const payment = this.db.prepare(`
      SELECT * FROM supplier_payments WHERE id = ?
    `).get(paymentId);
        if (!payment) {
            throw new supplier_balance_1.PaymentReversalError(`Payment '${paymentId}' not found.`);
        }
        if (payment.status === 'REVERSED') {
            throw new supplier_balance_1.PaymentReversalError(`Payment '${payment.payment_number}' has already been reversed.`);
        }
        // Find original ledger entry
        const originalLedger = this.db.prepare(`
      SELECT id, debit_minor, credit_minor, description FROM supplier_ledger_entries
      WHERE reference_id = ? AND entry_type = 'PAYMENT_DISBURSED'
    `).get(paymentId);
        const tx = this.db.transaction(() => {
            // 1. Mark payment reversed
            this.db.prepare(`
        UPDATE supplier_payments
        SET status = 'REVERSED',
            reversal_reason = ?,
            reversed_at = CURRENT_TIMESTAMP,
            reversed_by = ?
        WHERE id = ?
      `).run(reason.trim(), actor?.userId ? String(actor.userId) : null, paymentId);
            // 2. Remove / Void payment allocations
            this.db.prepare(`
        DELETE FROM supplier_payment_allocations WHERE supplier_payment_id = ?
      `).run(paymentId);
            // 3. Post reversal CREDIT entry to restore payable balance
            const reversalDelta = supplier_balance_1.SupplierBalanceCalculator.createReversalDelta({
                debitMinor: payment.amount_minor,
                creditMinor: 0,
                description: payment.notes || `Payment #${payment.payment_number}`
            }, reason.trim());
            this.recordSupplierLedgerEntry({
                businessId: payment.business_id,
                branchId: payment.branch_id,
                supplierId: payment.supplier_id,
                entryType: reversalDelta.entryType,
                referenceType: 'PAYMENT_REVERSAL',
                referenceId: paymentId,
                debitMinor: reversalDelta.debitMinor,
                creditMinor: reversalDelta.creditMinor,
                currencyCode: payment.currency_code,
                description: reversalDelta.description,
                createdBy: actor?.userId ? String(actor.userId) : null,
                reversalOfEntryId: originalLedger ? originalLedger.id : null
            });
        });
        tx();
    }
    // =========================================================================
    // 4. SUPPLIER RETURNS & ADJUSTMENTS
    // =========================================================================
    /**
     * Record Supplier Return:
     * - Decreases supplier payable balance via DEBIT entry
     */
    recordSupplierReturn(dto, actor) {
        const supplier = this.getSupplierById(dto.supplierId, dto.businessId || actor?.businessId);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${dto.supplierId}' not found.`);
        }
        if (!supplier.isActive) {
            throw new supplier_balance_1.InactiveSupplierError(supplier.name);
        }
        const amountMinor = Math.floor(Number(dto.amountMinor));
        if (amountMinor <= 0) {
            throw new supplier_balance_1.SupplierBalanceError('Return amount must be greater than zero.');
        }
        const businessId = dto.businessId || supplier.businessId || actor?.businessId || '00000000-0000-0000-0000-000000000001';
        const returnNumber = dto.returnNumber || `SRET-${Date.now().toString().slice(-6)}`;
        const returnDate = dto.returnDate || new Date().toISOString();
        const returnId = (0, crypto_1.randomUUID)();
        // DEBIT entry: decreases payable
        this.recordSupplierLedgerEntry({
            businessId,
            branchId: dto.branchId || actor?.branchId,
            supplierId: supplier.id,
            entryType: 'PURCHASE_RETURN',
            referenceType: 'PURCHASE_RETURN',
            referenceId: returnId,
            debitMinor: amountMinor,
            creditMinor: 0,
            currencyCode: dto.currencyCode || 'PKR',
            description: `Return #${returnNumber}: ${dto.reason}`,
            entryDate: returnDate,
            createdBy: actor?.userId ? String(actor.userId) : null
        });
        return returnId;
    }
    /**
     * Record Authorized Adjustment Document:
     * - DEBIT adjustment: Decreases payable
     * - CREDIT adjustment: Increases payable
     */
    recordAdjustment(dto, actor) {
        const supplier = this.getSupplierById(dto.supplierId, dto.businessId || actor?.businessId);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${dto.supplierId}' not found.`);
        }
        if (!supplier.isActive) {
            throw new supplier_balance_1.InactiveSupplierError(supplier.name);
        }
        const amountMinor = Math.floor(Number(dto.amountMinor));
        if (amountMinor <= 0) {
            throw new supplier_balance_1.SupplierBalanceError('Adjustment amount must be greater than zero.');
        }
        if (!dto.reason || !dto.reason.trim()) {
            throw new supplier_balance_1.SupplierBalanceError('A valid adjustment reason must be provided.');
        }
        const businessId = dto.businessId || supplier.businessId || actor?.businessId || '00000000-0000-0000-0000-000000000001';
        const adjustmentId = (0, crypto_1.randomUUID)();
        const isDebit = dto.adjustmentType === 'DEBIT';
        const debitMinor = isDebit ? amountMinor : 0;
        const creditMinor = isDebit ? 0 : amountMinor;
        const entryType = isDebit ? 'DEBIT_ADJUSTMENT' : 'CREDIT_ADJUSTMENT';
        this.recordSupplierLedgerEntry({
            businessId,
            branchId: dto.branchId || actor?.branchId,
            supplierId: supplier.id,
            entryType,
            referenceType: 'MANUAL_ADJUSTMENT',
            referenceId: adjustmentId,
            debitMinor,
            creditMinor,
            currencyCode: dto.currencyCode || 'PKR',
            description: `Adjustment (${dto.adjustmentType}): ${dto.reason}`,
            createdBy: actor?.userId ? String(actor.userId) : null
        });
        return adjustmentId;
    }
    // =========================================================================
    // 5. OUTSTANDING PURCHASE INVOICES & STATEMENTS
    // =========================================================================
    /**
     * Get outstanding purchase bills with payment due dates and overdue calculation
     */
    getOutstandingPurchaseInvoices(supplierId, businessId) {
        const supplier = this.getSupplierById(supplierId, businessId);
        if (!supplier)
            return [];
        const paymentTermsDays = supplier.paymentTermsDays || 0;
        const now = new Date();
        // Check purchases table or purchase_orders table
        const purchases = this.db.prepare(`
      SELECT p.id,
             COALESCE(p.purchase_number, po.invoice_number, 'PUR-' || p.id) as invoice_number,
             COALESCE(p.total_minor, po.grand_total, 0) as total_minor,
             COALESCE(po.amount_paid, 0) as amount_paid,
             COALESCE(p.created_at, po.created_at, CURRENT_TIMESTAMP) as created_at,
             COALESCE(SUM(spa.allocated_minor), 0) as total_allocated
      FROM purchases p
      LEFT JOIN purchase_orders po ON p.id = po.id
      LEFT JOIN supplier_payment_allocations spa ON CAST(p.id AS TEXT) = spa.purchase_document_id
      WHERE p.supplier_id = ? AND p.status != 'CANCELLED' AND p.status != 'VOIDED'
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `).all(String(supplier.id));
        const outstandingList = [];
        for (const p of purchases) {
            const totalMinor = Number(p.total_minor || 0);
            const allocatedMinor = Number(p.total_allocated || 0);
            const paidAtPurchase = Number(p.amount_paid || 0);
            const totalSettled = allocatedMinor + paidAtPurchase;
            const remainingDueMinor = totalMinor - totalSettled;
            if (remainingDueMinor > 0) {
                const purchaseDate = new Date(p.created_at || now);
                const dueDate = new Date(purchaseDate.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
                const isOverdue = paymentTermsDays > 0 && now > dueDate;
                const diffMs = now.getTime() - dueDate.getTime();
                const overdueDays = isOverdue ? Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000))) : 0;
                outstandingList.push({
                    purchaseId: p.id,
                    invoiceNumber: p.invoice_number,
                    purchaseDate: purchaseDate.toISOString(),
                    totalMinor,
                    allocatedMinor: totalSettled,
                    remainingDueMinor,
                    dueDate: dueDate.toISOString(),
                    isOverdue,
                    overdueDays
                });
            }
        }
        return outstandingList;
    }
    /**
     * Get Chronological Supplier Statement:
     * Shows opening balance, purchases, returns, payments, adjustments, and closing running balance.
     */
    getSupplierStatement(supplierId, fromDate, toDate, businessId) {
        const supplier = this.getSupplierById(supplierId, businessId);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${supplierId}' not found.`);
        }
        // 1. Calculate opening balance before fromDate
        let openingBalanceMinor = 0;
        if (fromDate) {
            const preRow = this.db.prepare(`
        SELECT COALESCE(SUM(credit_minor - debit_minor), 0) as balance
        FROM supplier_ledger_entries
        WHERE supplier_id = ? AND entry_date < ?
      `).get(supplier.id, fromDate);
            openingBalanceMinor = Number(preRow?.balance || 0);
        }
        // 2. Fetch statement entries in date range (strictly ordered by entry_date ASC, rowid ASC)
        let sql = `
      SELECT id, entry_date, entry_type, reference_type, reference_id,
             description, debit_minor, credit_minor
      FROM supplier_ledger_entries
      WHERE supplier_id = ?
    `;
        const params = [supplier.id];
        if (fromDate) {
            sql += ` AND entry_date >= ?`;
            params.push(fromDate);
        }
        if (toDate) {
            sql += ` AND entry_date <= ?`;
            params.push(toDate);
        }
        sql += ` ORDER BY entry_date ASC, CASE WHEN entry_type = 'OPENING_BALANCE' THEN 0 ELSE 1 END ASC, rowid ASC`;
        const rawEntries = this.db.prepare(sql).all(...params);
        // 3. Compute running balance and category summaries
        let totalPurchasesMinor = 0;
        let totalReturnsMinor = 0;
        let totalPaymentsMinor = 0;
        let totalAdjustmentsMinor = 0;
        let running = openingBalanceMinor;
        const entries = rawEntries.map(e => {
            const debit = Number(e.debit_minor || 0);
            const credit = Number(e.credit_minor || 0);
            running += (credit - debit);
            // Track summary buckets
            if (e.entry_type === 'PURCHASE_BILL') {
                totalPurchasesMinor += credit;
            }
            else if (e.entry_type === 'PURCHASE_RETURN') {
                totalReturnsMinor += debit;
            }
            else if (e.entry_type === 'PAYMENT_DISBURSED') {
                totalPaymentsMinor += debit;
            }
            else if (e.entry_type === 'PAYMENT_REVERSAL') {
                // Offset payment summary or treat as adjustment
                totalAdjustmentsMinor += (credit - debit);
            }
            else if (e.entry_type.includes('ADJUSTMENT')) {
                totalAdjustmentsMinor += (credit - debit);
            }
            return {
                id: e.id,
                entryDate: e.entry_date,
                entryType: e.entry_type,
                referenceType: e.reference_type,
                referenceId: e.reference_id,
                description: e.description || e.entry_type,
                debitMinor: debit,
                creditMinor: credit,
                runningBalanceMinor: running
            };
        });
        return {
            supplierId: supplier.id,
            supplierName: supplier.name,
            supplierCode: supplier.supplierCode,
            fromDate,
            toDate,
            openingBalanceMinor,
            totalPurchasesMinor,
            totalReturnsMinor,
            totalPaymentsMinor,
            totalAdjustmentsMinor,
            closingBalanceMinor: running,
            entries
        };
    }
    /**
     * Reconcile Supplier Balance:
     * Verifies that cached balance matches authoritative ledger sum, auto-correcting any discrepancy.
     */
    reconcileSupplierBalance(supplierId) {
        const supplier = this.getSupplierById(supplierId);
        if (!supplier) {
            throw new supplier_balance_1.SupplierBalanceError(`Supplier '${supplierId}' not found.`);
        }
        const cachedBalance = supplier.balance;
        const ledgerBalance = this.calculateLedgerBalance(supplier.id);
        const discrepancy = cachedBalance - ledgerBalance;
        if (discrepancy !== 0) {
            this.db.prepare(`
        UPDATE suppliers SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(ledgerBalance, supplier.id);
        }
        return {
            isReconciled: discrepancy === 0,
            cachedBalance,
            ledgerBalance,
            discrepancy
        };
    }
}
exports.SupplierService = SupplierService;
