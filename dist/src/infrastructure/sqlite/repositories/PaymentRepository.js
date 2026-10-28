"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentRepository = void 0;
const connection_1 = require("../connection");
class PaymentRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Retrieves payment method details (checks if affects cash drawer).
     */
    getPaymentMethod(id) {
        const row = this.db.prepare(`
      SELECT id, name, method_type as methodType, affects_cash_drawer as affectsCashDrawer, is_active as isActive
      FROM payment_methods
      WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return {
            ...row,
            affectsCashDrawer: Boolean(row.affectsCashDrawer),
            isActive: Boolean(row.isActive)
        };
    }
    listPaymentMethods() {
        const rows = this.db.prepare(`
      SELECT id, name, method_type as methodType, affects_cash_drawer as affectsCashDrawer, is_active as isActive
      FROM payment_methods
      WHERE is_active = 1
      ORDER BY id ASC
    `).all();
        return rows.map(r => ({
            ...r,
            affectsCashDrawer: Boolean(r.affectsCashDrawer),
            isActive: Boolean(r.isActive)
        }));
    }
    /**
     * Records a payment with multiple document allocations.
     * e.g., A customer pays Rs. 5,000:
     * Allocation 1: Rs. 2,000 to Invoice 1
     * Allocation 2: Rs. 3,000 to Invoice 2
     */
    createPaymentWithAllocations(payment) {
        const totalAllocated = payment.allocations.reduce((sum, a) => sum + a.amountMinor, 0);
        if (totalAllocated > payment.amountMinor) {
            throw new Error(`Total allocated amount (${totalAllocated}) cannot exceed payment amount (${payment.amountMinor})`);
        }
        const info = this.db.prepare(`
      INSERT INTO payments (
        payment_number, party_type, party_id, direction, amount_minor,
        payment_method_id, cash_session_id, status, notes, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(payment.paymentNumber, payment.partyType, payment.partyId || null, payment.direction, payment.amountMinor, payment.paymentMethodId, payment.cashSessionId || null, payment.notes || null, payment.createdBy);
        const paymentId = Number(info.lastInsertRowid);
        // Insert individual payment allocations
        const insertAlloc = this.db.prepare(`
      INSERT INTO payment_allocations (payment_id, document_type, document_id, amount_minor)
      VALUES (?, ?, ?, ?)
    `);
        for (const alloc of payment.allocations) {
            insertAlloc.run(paymentId, alloc.documentType, alloc.documentId, alloc.amountMinor);
        }
        // Check if payment method affects physical cash drawer
        const method = this.getPaymentMethod(payment.paymentMethodId);
        if (method?.affectsCashDrawer && payment.cashSessionId) {
            this.recordCashMovement({
                cashSessionId: payment.cashSessionId,
                movementType: payment.partyType === 'CUSTOMER' ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT',
                amountMinor: payment.amountMinor,
                direction: payment.direction === 'INBOUND' ? 'IN' : 'OUT',
                sourceType: 'PAYMENT',
                sourceId: paymentId,
                notes: `Payment #${payment.paymentNumber}`
            });
        }
        return paymentId;
    }
    getPaymentById(id) {
        const row = this.db.prepare(`
      SELECT p.id, p.payment_number as paymentNumber, p.party_type as partyType,
             p.party_id as partyId, p.direction, p.amount_minor as amountMinor,
             p.payment_method_id as paymentMethodId, pm.name as paymentMethodName,
             p.cash_session_id as cashSessionId, p.status, p.notes,
             p.created_by as createdBy, p.created_at as createdAt
      FROM payments p
      LEFT JOIN payment_methods pm ON p.payment_method_id = pm.id
      WHERE p.id = ?
    `).get(id);
        if (!row)
            return null;
        const allocations = this.db.prepare(`
      SELECT id, payment_id as paymentId, document_type as documentType,
             document_id as documentId, amount_minor as amountMinor, created_at as createdAt
      FROM payment_allocations
      WHERE payment_id = ?
    `).all(id);
        return {
            ...row,
            allocations
        };
    }
    // --- Cash Sessions & Drawer Reconciliation ---
    openCashSession(registerId, userId, openingCashMinor) {
        const info = this.db.prepare(`
      INSERT INTO cash_sessions (register_id, opened_by, opening_cash_minor, status)
      VALUES (?, ?, ?, 'OPEN')
    `).run(registerId, userId, openingCashMinor);
        const sessionId = Number(info.lastInsertRowid);
        if (openingCashMinor > 0) {
            this.recordCashMovement({
                cashSessionId: sessionId,
                movementType: 'OPENING_FLOAT',
                amountMinor: openingCashMinor,
                direction: 'IN',
                sourceType: 'MANUAL',
                sourceId: sessionId,
                notes: 'Register morning opening float'
            });
        }
        return sessionId;
    }
    getActiveSession(registerId) {
        const row = this.db.prepare(`
      SELECT id, register_id as registerId, opened_by as openedBy,
             opening_cash_minor as openingCashMinor, closed_by as closedBy,
             expected_cash_minor as expectedCashMinor, counted_cash_minor as countedCashMinor,
             difference_minor as differenceMinor, status, opened_at as openedAt, closed_at as closedAt
      FROM cash_sessions
      WHERE register_id = ? AND status = 'OPEN'
      ORDER BY id DESC
      LIMIT 1
    `).get(registerId);
        return row || null;
    }
    recordCashMovement(movement) {
        const info = this.db.prepare(`
      INSERT INTO cash_movements (cash_session_id, movement_type, amount_minor, direction, source_type, source_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(movement.cashSessionId, movement.movementType, movement.amountMinor, movement.direction, movement.sourceType, movement.sourceId || null, movement.notes || null);
        return Number(info.lastInsertRowid);
    }
    closeCashSession(sessionId, closedBy, countedCashMinor) {
        // 1. Calculate expected cash from cash_movements: opening float + IN movements - OUT movements
        const inRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) as totalIn
      FROM cash_movements
      WHERE cash_session_id = ? AND direction = 'IN'
    `).get(sessionId);
        const outRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) as totalOut
      FROM cash_movements
      WHERE cash_session_id = ? AND direction = 'OUT'
    `).get(sessionId);
        const expectedCash = inRow.totalIn - outRow.totalOut;
        const difference = countedCashMinor - expectedCash; // positive = overage, negative = shortage
        this.db.prepare(`
      UPDATE cash_sessions
      SET closed_by = ?,
          expected_cash_minor = ?,
          counted_cash_minor = ?,
          difference_minor = ?,
          status = 'CLOSED',
          closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(closedBy, expectedCash, countedCashMinor, difference, sessionId);
        return this.db.prepare(`
      SELECT id, register_id as registerId, opened_by as openedBy,
             opening_cash_minor as openingCashMinor, closed_by as closedBy,
             expected_cash_minor as expectedCashMinor, counted_cash_minor as countedCashMinor,
             difference_minor as differenceMinor, status, opened_at as openedAt, closed_at as closedAt
      FROM cash_sessions
      WHERE id = ?
    `).get(sessionId);
    }
}
exports.PaymentRepository = PaymentRepository;
