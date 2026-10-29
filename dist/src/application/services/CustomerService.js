"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerService = exports.PaymentAllocationError = exports.DuplicateCustomerCodeError = exports.CustomerNotFoundError = void 0;
const crypto_1 = require("crypto");
const credit_control_1 = require("../../domain/customers/credit-control");
class CustomerNotFoundError extends Error {
    constructor(id) {
        super(`Customer not found with ID "${id}".`);
        this.name = 'CustomerNotFoundError';
    }
}
exports.CustomerNotFoundError = CustomerNotFoundError;
class DuplicateCustomerCodeError extends Error {
    constructor(code) {
        super(`Customer code "${code}" already exists for this business.`);
        this.name = 'DuplicateCustomerCodeError';
    }
}
exports.DuplicateCustomerCodeError = DuplicateCustomerCodeError;
class PaymentAllocationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PaymentAllocationError';
    }
}
exports.PaymentAllocationError = PaymentAllocationError;
class CustomerService {
    db;
    constructor(db) {
        this.db = db;
    }
    // -------------------------------------------------------------------------
    // 1. CUSTOMER CRUD & WALK-IN LOOKUP
    // -------------------------------------------------------------------------
    createCustomer(dto, actor) {
        if (!dto.name || !dto.name.trim()) {
            throw new Error('Customer name is required.');
        }
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const code = (dto.customerCode && dto.customerCode.trim())
            ? dto.customerCode.trim().toUpperCase()
            : `CUST-${Date.now().toString().slice(-6)}`;
        // Verify customer_code uniqueness in this business
        const existing = this.db.prepare(`
      SELECT id FROM customers WHERE business_id = ? AND customer_code = ?
    `).get(businessId, code);
        if (existing) {
            throw new DuplicateCustomerCodeError(code);
        }
        const id = (0, crypto_1.randomUUID)();
        const customerType = dto.customerType || 'retail';
        const creditLimitMinor = dto.creditLimitMinor !== undefined ? Math.max(0, dto.creditLimitMinor) : 0;
        const creditDays = dto.creditDays !== undefined ? Math.max(0, dto.creditDays) : 0;
        const openingBalanceMinor = dto.openingBalanceMinor || 0;
        const isActive = dto.isActive !== false ? 1 : 0;
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO customers (
          id, business_id, customer_code, name, phone, email, address,
          tax_number, customer_type, credit_limit_minor, credit_days,
          opening_balance_minor, notes, is_active, balance, credit_limit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, businessId, code, dto.name.trim(), dto.phone ? dto.phone.trim() : null, dto.email ? dto.email.trim() : null, dto.address ? dto.address.trim() : null, dto.taxNumber ? dto.taxNumber.trim() : null, customerType, creditLimitMinor, creditDays, openingBalanceMinor, dto.notes || null, isActive, openingBalanceMinor, // initial cached balance equals opening balance
            creditLimitMinor);
            // Record opening balance in customer_ledger_entries if non-zero
            if (openingBalanceMinor !== 0) {
                const ledgerId = (0, crypto_1.randomUUID)();
                const isDebit = openingBalanceMinor > 0;
                const debitMinor = isDebit ? openingBalanceMinor : 0;
                const creditMinor = isDebit ? 0 : Math.abs(openingBalanceMinor);
                this.db.prepare(`
          INSERT INTO customer_ledger_entries (
            id, business_id, branch_id, customer_id, entry_type,
            reference_type, debit_minor, credit_minor, currency_code,
            description, entry_date, created_by, source_type, notes
          )
          VALUES (?, ?, ?, ?, 'OPENING_BALANCE', 'OPENING_BALANCE', ?, ?, 'PKR', ?, ?, ?, 'OPENING_BALANCE', ?)
        `).run(ledgerId, businessId, actor.branchId || null, id, debitMinor, creditMinor, 'Initial account opening balance', new Date().toISOString(), actor.userId ? String(actor.userId) : null, 'Initial account opening balance');
            }
        });
        tx();
        return this.getCustomerById(businessId, id);
    }
    updateCustomer(id, dto, actor) {
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const existing = this.db.prepare(`
      SELECT * FROM customers WHERE id = ? AND business_id = ?
    `).get(id, businessId);
        if (!existing) {
            throw new CustomerNotFoundError(id);
        }
        if (dto.customerCode && dto.customerCode.trim().toUpperCase() !== existing.customer_code) {
            const code = dto.customerCode.trim().toUpperCase();
            const collision = this.db.prepare(`
        SELECT id FROM customers WHERE business_id = ? AND customer_code = ? AND id != ?
      `).get(businessId, code, id);
            if (collision) {
                throw new DuplicateCustomerCodeError(code);
            }
        }
        const isPhoneProvided = dto.phone !== undefined ? 1 : null;
        const isEmailProvided = dto.email !== undefined ? 1 : null;
        const isAddressProvided = dto.address !== undefined ? 1 : null;
        const isTaxProvided = dto.taxNumber !== undefined ? 1 : null;
        const isNotesProvided = dto.notes !== undefined ? 1 : null;
        this.db.prepare(`
      UPDATE customers
      SET customer_code = COALESCE(?, customer_code),
          name = COALESCE(?, name),
          phone = CASE WHEN ? IS NOT NULL THEN ? ELSE phone END,
          email = CASE WHEN ? IS NOT NULL THEN ? ELSE email END,
          address = CASE WHEN ? IS NOT NULL THEN ? ELSE address END,
          tax_number = CASE WHEN ? IS NOT NULL THEN ? ELSE tax_number END,
          customer_type = COALESCE(?, customer_type),
          credit_limit_minor = COALESCE(?, credit_limit_minor),
          credit_days = COALESCE(?, credit_days),
          notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
          is_active = COALESCE(?, is_active),
          credit_limit = COALESCE(?, credit_limit),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ?
    `).run(dto.customerCode ? dto.customerCode.trim().toUpperCase() : null, dto.name ? dto.name.trim() : null, isPhoneProvided, dto.phone ? dto.phone.trim() : null, isEmailProvided, dto.email ? dto.email.trim() : null, isAddressProvided, dto.address ? dto.address.trim() : null, isTaxProvided, dto.taxNumber ? dto.taxNumber.trim() : null, dto.customerType || null, dto.creditLimitMinor !== undefined ? dto.creditLimitMinor : null, dto.creditDays !== undefined ? dto.creditDays : null, isNotesProvided, dto.notes || null, dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : null, dto.creditLimitMinor !== undefined ? dto.creditLimitMinor : null, id, businessId);
        return this.getCustomerById(businessId, id);
    }
    getCustomerById(businessId, id) {
        const row = this.db.prepare(`
      SELECT id, business_id, customer_code, name, phone, email, address,
             tax_number, customer_type, credit_limit_minor, credit_days,
             opening_balance_minor, notes, is_active, created_at, updated_at,
             balance
      FROM customers
      WHERE id = ? AND business_id = ?
    `).get(id, businessId);
        if (!row)
            return null;
        const calculatedBalanceMinor = this.calculateLedgerBalance(id);
        const outstandingInvoices = this.getOutstandingInvoices(businessId, id);
        const overdueInvoices = outstandingInvoices.filter(i => i.isOverdue);
        const overdueAmountMinor = overdueInvoices.reduce((sum, i) => sum + i.outstandingMinor, 0);
        const creditLimit = row.credit_limit_minor || 0;
        const availableCreditMinor = creditLimit > 0 ? Math.max(0, creditLimit - calculatedBalanceMinor) : undefined;
        return {
            id: row.id,
            businessId: row.business_id,
            customerCode: row.customer_code,
            name: row.name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            taxNumber: row.tax_number,
            customerType: row.customer_type,
            creditLimitMinor: creditLimit,
            creditDays: row.credit_days || 0,
            openingBalanceMinor: row.opening_balance_minor || 0,
            notes: row.notes,
            isActive: Boolean(row.is_active),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            balanceMinor: row.balance,
            calculatedBalanceMinor,
            isOverdue: overdueInvoices.length > 0,
            overdueAmountMinor,
            availableCreditMinor
        };
    }
    listCustomers(businessId, options) {
        let sql = `
      SELECT id, business_id, customer_code, name, phone, email, address,
             tax_number, customer_type, credit_limit_minor, credit_days,
             opening_balance_minor, notes, is_active, created_at, updated_at,
             balance
      FROM customers
      WHERE business_id = ?
    `;
        const params = [businessId];
        if (options?.query) {
            const q = `%${options.query.trim()}%`;
            sql += ` AND (name LIKE ? OR customer_code LIKE ? OR phone LIKE ?)`;
            params.push(q, q, q);
        }
        if (options?.customerType) {
            sql += ` AND customer_type = ?`;
            params.push(options.customerType);
        }
        if (options?.isActive !== undefined) {
            sql += ` AND is_active = ?`;
            params.push(options.isActive ? 1 : 0);
        }
        sql += ` ORDER BY name ASC`;
        const rows = this.db.prepare(sql).all(...params);
        const result = rows.map((row) => {
            const calculatedBalanceMinor = this.calculateLedgerBalance(row.id);
            return {
                id: row.id,
                businessId: row.business_id,
                customerCode: row.customer_code,
                name: row.name,
                phone: row.phone,
                email: row.email,
                address: row.address,
                taxNumber: row.tax_number,
                customerType: row.customer_type,
                creditLimitMinor: row.credit_limit_minor || 0,
                creditDays: row.credit_days || 0,
                openingBalanceMinor: row.opening_balance_minor || 0,
                notes: row.notes,
                isActive: Boolean(row.is_active),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                balanceMinor: row.balance,
                calculatedBalanceMinor
            };
        });
        if (options?.overdueOnly) {
            return result.filter(c => {
                const invoices = this.getOutstandingInvoices(businessId, c.id);
                return invoices.some(i => i.isOverdue);
            });
        }
        return result;
    }
    /**
     * Dedicated walk-in customer record lookup.
     * Guarantees a valid Walk-in customer record is returned for any active business.
     */
    getWalkInCustomer(businessId) {
        let row = this.db.prepare(`
      SELECT id, business_id, customer_code, name, phone, email, address,
             tax_number, customer_type, credit_limit_minor, credit_days,
             opening_balance_minor, notes, is_active, created_at, updated_at, balance
      FROM customers
      WHERE business_id = ? AND customer_code = 'WALK-IN'
    `).get(businessId);
        if (!row) {
            // Seed on-demand if not already created
            const id = (0, crypto_1.randomUUID)();
            this.db.prepare(`
        INSERT OR IGNORE INTO customers (
          id, business_id, customer_code, name, customer_type,
          credit_limit_minor, credit_days, opening_balance_minor, is_active,
          notes, balance, credit_limit
        )
        VALUES (?, ?, 'WALK-IN', 'Walk-in Customer', 'retail', 0, 0, 0, 1, 'Standard walk-in customer', 0, 0)
      `).run(id, businessId);
            row = this.db.prepare(`
        SELECT id, business_id, customer_code, name, phone, email, address,
               tax_number, customer_type, credit_limit_minor, credit_days,
               opening_balance_minor, notes, is_active, created_at, updated_at, balance
        FROM customers
        WHERE business_id = ? AND customer_code = 'WALK-IN'
      `).get(businessId);
        }
        return {
            id: row.id,
            businessId: row.business_id,
            customerCode: row.customer_code,
            name: row.name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            taxNumber: row.tax_number,
            customerType: row.customer_type,
            creditLimitMinor: 0,
            creditDays: 0,
            openingBalanceMinor: 0,
            notes: row.notes,
            isActive: Boolean(row.is_active),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            balanceMinor: 0,
            calculatedBalanceMinor: 0
        };
    }
    // -------------------------------------------------------------------------
    // 2. AUTHORITATIVE LEDGER & BALANCE CALCULATION
    // -------------------------------------------------------------------------
    /**
     * Authoritative source of truth:
     * Balance = Total Debits (Receivables) - Total Credits (Payments / Returns)
     */
    calculateLedgerBalance(customerId) {
        const row = this.db.prepare(`
      SELECT COALESCE(SUM(debit_minor - credit_minor), 0) as balance
      FROM customer_ledger_entries
      WHERE customer_id = ?
    `).get(customerId);
        return Number(row?.balance || 0);
    }
    /**
     * Records an audited customer ledger entry and synchronizes the cached customer balance.
     */
    recordCustomerLedgerEntry(entry, actor) {
        const debit = Math.max(0, entry.debitMinor || 0);
        const credit = Math.max(0, entry.creditMinor || 0);
        if (debit > 0 && credit > 0) {
            throw new Error('A single customer ledger entry cannot contain both a debit and a credit.');
        }
        const id = (0, crypto_1.randomUUID)();
        const entryDate = entry.entryDate || new Date().toISOString();
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO customer_ledger_entries (
          id, business_id, branch_id, customer_id, entry_type,
          reference_type, reference_id, debit_minor, credit_minor,
          currency_code, description, entry_date, created_by,
          reversal_of_entry_id, source_type, source_id, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?, ?, ?)
      `).run(id, entry.businessId, entry.branchId || null, entry.customerId, entry.entryType, entry.referenceType || null, entry.referenceId ? String(entry.referenceId) : null, debit, credit, entry.description || null, entryDate, actor.userId ? String(actor.userId) : null, entry.reversalOfEntryId ? String(entry.reversalOfEntryId) : null, entry.referenceType || null, entry.referenceId ? String(entry.referenceId) : null, entry.description || null);
            // Recalculate authoritative balance directly from ledger sum
            const newAuthoritativeBalance = this.calculateLedgerBalance(entry.customerId);
            // Update customer cached balance
            this.db.prepare(`
        UPDATE customers SET balance = ? WHERE id = ?
      `).run(newAuthoritativeBalance, entry.customerId);
        });
        tx();
        return {
            id,
            businessId: entry.businessId,
            branchId: entry.branchId,
            customerId: entry.customerId,
            entryType: entry.entryType,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            debitMinor: debit,
            creditMinor: credit,
            currencyCode: 'PKR',
            description: entry.description,
            entryDate,
            createdBy: actor.userId
        };
    }
    // -------------------------------------------------------------------------
    // 3. CREDIT CONTROL EVALUATION
    // -------------------------------------------------------------------------
    checkCreditExposure(businessId, customerId, newCreditMinor, hasManagerApproval = false) {
        const customer = this.getCustomerById(businessId, customerId);
        if (!customer) {
            throw new CustomerNotFoundError(customerId);
        }
        // Retrieve business credit policy
        let policy = 'BLOCK';
        const biz = this.db.prepare(`
      SELECT credit_policy FROM businesses WHERE id = ?
    `).get(businessId);
        if (biz?.credit_policy) {
            policy = biz.credit_policy;
        }
        const outstandingInvoices = this.getOutstandingInvoices(businessId, customerId);
        return credit_control_1.CreditControlEvaluator.evaluate({
            customer,
            newCreditMinor,
            policy,
            outstandingInvoices,
            hasManagerApproval
        });
    }
    // -------------------------------------------------------------------------
    // 4. OUTSTANDING INVOICES & PAYMENT ALLOCATIONS
    // -------------------------------------------------------------------------
    /**
     * Retrieves all unpaid or partially paid sales documents for a customer.
     * Calculates outstanding amount from total minus allocated payments and refunds.
     */
    getOutstandingInvoices(businessId, customerId) {
        const customer = this.db.prepare(`
      SELECT credit_days FROM customers WHERE id = ?
    `).get(customerId);
        const creditDays = customer?.credit_days || 0;
        const now = new Date();
        // Find sales for this customer with outstanding balances
        const sales = this.db.prepare(`
      SELECT s.id, s.invoice_number, s.grand_total, s.created_at,
             COALESCE(SUM(cpa.allocated_minor), 0) as total_allocated
      FROM sales s
      LEFT JOIN customer_payment_allocations cpa ON s.id = cpa.sales_document_id
      WHERE s.customer_id = ? AND s.status != 'VOIDED'
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `).all(customerId);
        const outstandingList = [];
        for (const s of sales) {
            const totalMinor = Number(s.grand_total || 0);
            const paidMinor = Number(s.total_allocated || 0);
            const outstandingMinor = totalMinor - paidMinor;
            if (outstandingMinor > 0) {
                const saleDate = new Date(s.created_at || now);
                const dueDate = new Date(saleDate.getTime() + creditDays * 24 * 60 * 60 * 1000);
                const isOverdue = creditDays > 0 && now > dueDate;
                const diffMs = now.getTime() - dueDate.getTime();
                const overdueDays = isOverdue ? Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000))) : 0;
                outstandingList.push({
                    salesDocumentId: s.id,
                    saleNumber: s.invoice_number || `INV-${s.id}`,
                    saleDate: s.created_at,
                    totalMinor,
                    paidMinor,
                    outstandingMinor,
                    creditDays,
                    dueDate: dueDate.toISOString().split('T')[0],
                    isOverdue,
                    overdueDays
                });
            }
        }
        return outstandingList;
    }
    /**
     * Allocates a payment against one or more posted sales documents.
     * Strictly prevents allocating more than available payment or document balance.
     */
    allocatePayment(dto, actor) {
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        // Verify payment exists
        const payment = this.db.prepare(`
      SELECT id, amount_minor, party_id FROM payments WHERE id = ?
    `).get(dto.paymentId);
        if (!payment) {
            throw new PaymentAllocationError(`Payment "${dto.paymentId}" does not exist.`);
        }
        const totalPaymentAmount = Number(payment.amount_minor);
        // Sum existing allocations for this payment
        const existingAllocations = this.db.prepare(`
      SELECT COALESCE(SUM(allocated_minor), 0) as sum_allocated
      FROM customer_payment_allocations
      WHERE payment_id = ?
    `).get(dto.paymentId);
        const currentAllocated = Number(existingAllocations?.sum_allocated || 0);
        const unallocatedRemaining = totalPaymentAmount - currentAllocated;
        const requestedTotal = dto.allocations.reduce((acc, a) => acc + a.amountMinor, 0);
        if (requestedTotal > unallocatedRemaining) {
            throw new PaymentAllocationError(`Requested allocation amount (Rs. ${(requestedTotal / 100).toFixed(2)}) exceeds available payment amount (Rs. ${(unallocatedRemaining / 100).toFixed(2)}).`);
        }
        const createdAllocations = [];
        const tx = this.db.transaction(() => {
            for (const item of dto.allocations) {
                if (item.amountMinor <= 0)
                    continue;
                // Check document outstanding balance
                const sale = this.db.prepare(`
          SELECT s.id, s.grand_total,
                 COALESCE(SUM(cpa.allocated_minor), 0) as total_allocated
          FROM sales s
          LEFT JOIN customer_payment_allocations cpa ON s.id = cpa.sales_document_id
          WHERE s.id = ?
          GROUP BY s.id
        `).get(item.salesDocumentId);
                if (!sale) {
                    throw new PaymentAllocationError(`Sales document "${item.salesDocumentId}" not found.`);
                }
                const totalDue = Number(sale.grand_total);
                const previouslyPaid = Number(sale.total_allocated);
                const remainingDue = totalDue - previouslyPaid;
                if (item.amountMinor > remainingDue) {
                    throw new PaymentAllocationError(`Cannot allocate Rs. ${(item.amountMinor / 100).toFixed(2)} to Invoice #${item.salesDocumentId}: remaining due is only Rs. ${(remainingDue / 100).toFixed(2)}.`);
                }
                const allocId = (0, crypto_1.randomUUID)();
                this.db.prepare(`
          INSERT INTO customer_payment_allocations (
            id, business_id, payment_id, sales_document_id, allocated_minor
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(allocId, businessId, dto.paymentId, item.salesDocumentId, item.amountMinor);
                createdAllocations.push({
                    id: allocId,
                    businessId,
                    paymentId: dto.paymentId,
                    salesDocumentId: item.salesDocumentId,
                    allocatedMinor: item.amountMinor
                });
            }
        });
        tx();
        return createdAllocations;
    }
    /**
     * High-Level Customer Payment:
     * 1. Records payment in payments table.
     * 2. Allocates to specified invoices (or supports advance unallocated payment).
     * 3. Records PAYMENT_RECEIVED in customer ledger (Credit = amountMinor).
     * 4. Updates customer balance.
     */
    recordCustomerPayment(dto, actor) {
        if (dto.amountMinor <= 0) {
            throw new Error('Payment amount must be greater than zero.');
        }
        const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const customer = this.getCustomerById(businessId, dto.customerId);
        if (!customer) {
            throw new CustomerNotFoundError(dto.customerId);
        }
        const paymentNumber = `PAY-CUST-${Date.now()}`;
        const paymentMethodId = dto.paymentMethodId || 1; // Default Cash
        let createdAllocations = [];
        let paymentId;
        const tx = this.db.transaction(() => {
            // 1. Insert Payment
            const pInfo = this.db.prepare(`
        INSERT INTO payments (
          payment_number, party_type, party_id, direction, amount_minor,
          payment_method_id, cash_session_id, status, notes, created_by
        )
        VALUES (?, 'CUSTOMER', ?, 'INBOUND', ?, ?, ?, 'COMPLETED', ?, ?)
      `).run(paymentNumber, customer.id, dto.amountMinor, paymentMethodId, dto.cashSessionId || null, dto.notes || 'Customer payment towards receivables', actor.userId ? Number(actor.userId) || 1 : 1);
            paymentId = pInfo.lastInsertRowid;
            // 2. Process Allocations if specified
            if (dto.allocations && dto.allocations.length > 0) {
                createdAllocations = this.allocatePayment({
                    businessId,
                    paymentId,
                    allocations: dto.allocations
                }, actor);
            }
            // 3. Record in Customer Ledger: Credit customer account (decreases receivable)
            this.recordCustomerLedgerEntry({
                businessId,
                branchId: dto.branchId || actor.branchId,
                customerId: customer.id,
                entryType: 'PAYMENT_RECEIVED',
                referenceType: 'PAYMENT',
                referenceId: paymentId,
                creditMinor: dto.amountMinor,
                description: dto.notes || `Payment received (${paymentNumber})`
            }, actor);
        });
        tx();
        const allocatedSum = createdAllocations.reduce((sum, a) => sum + a.allocatedMinor, 0);
        const advanceCreditMinor = dto.amountMinor - allocatedSum;
        return {
            paymentId,
            allocations: createdAllocations,
            advanceCreditMinor
        };
    }
    // -------------------------------------------------------------------------
    // 5. ACCOUNT STATEMENT & RECONCILIATION
    // -------------------------------------------------------------------------
    getCustomerStatement(businessId, customerId, fromDate, toDate) {
        const customer = this.getCustomerById(businessId, customerId);
        if (!customer) {
            throw new CustomerNotFoundError(customerId);
        }
        let sql = `
      SELECT id, business_id, branch_id, customer_id, entry_type,
             reference_type, reference_id, debit_minor, credit_minor,
             currency_code, description, entry_date, created_at, created_by,
             reversal_of_entry_id
      FROM customer_ledger_entries
      WHERE customer_id = ?
    `;
        const params = [customerId];
        if (fromDate) {
            sql += ` AND entry_date >= ?`;
            params.push(fromDate);
        }
        if (toDate) {
            sql += ` AND entry_date <= ?`;
            params.push(toDate);
        }
        sql += ` ORDER BY entry_date ASC, rowid ASC`;
        const rows = this.db.prepare(sql).all(...params);
        let running = 0;
        let totalDebits = 0;
        let totalCredits = 0;
        const entries = rows.map((r) => {
            const debit = Number(r.debit_minor || 0);
            const credit = Number(r.credit_minor || 0);
            totalDebits += debit;
            totalCredits += credit;
            running += (debit - credit);
            return {
                id: r.id,
                businessId: r.business_id,
                branchId: r.branch_id,
                customerId: r.customer_id,
                entryType: r.entry_type,
                referenceType: r.reference_type,
                referenceId: r.reference_id,
                debitMinor: debit,
                creditMinor: credit,
                currencyCode: r.currency_code || 'PKR',
                description: r.description,
                entryDate: r.entry_date,
                createdAt: r.created_at,
                createdBy: r.created_by,
                reversalOfEntryId: r.reversal_of_entry_id,
                runningBalanceMinor: running
            };
        });
        const closingBalanceMinor = running;
        const authoritativeBalance = this.calculateLedgerBalance(customerId);
        const discrepancy = closingBalanceMinor - authoritativeBalance;
        return {
            customerId: customer.id,
            customerCode: customer.customerCode,
            customerName: customer.name,
            customerType: customer.customerType,
            creditLimitMinor: customer.creditLimitMinor,
            creditDays: customer.creditDays,
            openingBalanceMinor: customer.openingBalanceMinor,
            totalDebitsMinor: totalDebits,
            totalCreditsMinor: totalCredits,
            closingBalanceMinor,
            isReconciled: discrepancy === 0,
            discrepancyMinor: discrepancy,
            entries
        };
    }
    reconcileCustomerBalance(businessId, customerId) {
        const customer = this.getCustomerById(businessId, customerId);
        if (!customer) {
            throw new CustomerNotFoundError(customerId);
        }
        const ledgerBalance = this.calculateLedgerBalance(customerId);
        const cachedBalance = customer.balanceMinor ?? 0;
        const discrepancy = cachedBalance - ledgerBalance;
        if (discrepancy !== 0) {
            // Sync cached balance with authoritative ledger sum
            this.db.prepare(`
        UPDATE customers SET balance = ? WHERE id = ?
      `).run(ledgerBalance, customerId);
        }
        return {
            isReconciled: true,
            cachedBalance: ledgerBalance,
            ledgerBalance,
            discrepancy: 0
        };
    }
}
exports.CustomerService = CustomerService;
