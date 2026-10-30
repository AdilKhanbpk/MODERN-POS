"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockReservationRepository = void 0;
const connection_1 = require("../connection");
class StockReservationRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Atomically persists a reservation and its child lines.
     */
    create(reservation, lines) {
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO stock_reservations (
          id, business_id, branch_id, reservation_number, customer_id,
          source_type, source_id, status, reserved_at, expires_at,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reservation.id, reservation.businessId, reservation.branchId, reservation.reservationNumber, reservation.customerId || null, reservation.sourceType, reservation.sourceId || null, reservation.status, reservation.reservedAt || null, reservation.expiresAt || null, reservation.createdBy, reservation.createdAt, reservation.updatedAt);
            const insertLine = this.db.prepare(`
        INSERT INTO stock_reservation_lines (
          id, reservation_id, product_id, variant_id, stock_location_id,
          batch_id, reserved_quantity_scaled, fulfilled_quantity_scaled,
          released_quantity_scaled, unit_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const line of lines) {
                insertLine.run(line.id, line.reservationId, String(line.productId), line.variantId ? String(line.variantId) : null, line.stockLocationId, line.batchId ? String(line.batchId) : null, line.reservedQuantityScaled, line.fulfilledQuantityScaled || 0, line.releasedQuantityScaled || 0, line.unitId ? String(line.unitId) : null, reservation.createdAt);
            }
        });
        tx();
        return this.findById(reservation.id);
    }
    /**
     * Retrieves a single reservation with its lines and joined details.
     */
    findById(id) {
        const row = this.db.prepare(`
      SELECT r.*,
             c.name as customer_name,
             b.name as branch_name,
             u.full_name as creator_name
      FROM stock_reservations r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN branches b ON r.branch_id = b.id
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.id = ?
    `).get(id);
        if (!row)
            return null;
        const lines = this.getLinesByReservationId(id);
        return {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            reservationNumber: row.reservation_number,
            customerId: row.customer_id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            status: row.status,
            reservedAt: row.reserved_at,
            expiresAt: row.expires_at,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            customerName: row.customer_name,
            branchName: row.branch_name,
            creatorName: row.creator_name,
            lines
        };
    }
    /**
     * Retrieves reservation by its unique business reservation number.
     */
    findByReservationNumber(reservationNumber) {
        const row = this.db.prepare(`
      SELECT id FROM stock_reservations WHERE reservation_number = ?
    `).get(reservationNumber);
        return row ? this.findById(row.id) : null;
    }
    /**
     * Retrieves lines belonging to a reservation.
     */
    getLinesByReservationId(reservationId) {
        const rows = this.db.prepare(`
      SELECT l.*,
             p.name as product_name,
             p.sku as sku,
             loc.name as location_name,
             u.name as unit_name
      FROM stock_reservation_lines l
      JOIN products p ON l.product_id = p.id
      JOIN stock_locations loc ON l.stock_location_id = loc.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE l.reservation_id = ?
    `).all(reservationId);
        return rows.map((r) => ({
            id: r.id,
            reservationId: r.reservation_id,
            productId: r.product_id,
            variantId: r.variant_id,
            stockLocationId: r.stock_location_id,
            batchId: r.batch_id,
            reservedQuantityScaled: Number(r.reserved_quantity_scaled),
            fulfilledQuantityScaled: Number(r.fulfilled_quantity_scaled),
            releasedQuantityScaled: Number(r.released_quantity_scaled),
            unitId: r.unit_id,
            productName: r.product_name,
            sku: r.sku,
            locationName: r.location_name,
            unitName: r.unit_name
        }));
    }
    /**
     * Lists reservations according to filtering criteria.
     */
    list(filter) {
        let sql = `
      SELECT r.*,
             c.name as customer_name,
             b.name as branch_name,
             u.full_name as creator_name
      FROM stock_reservations r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN branches b ON r.branch_id = b.id
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.business_id = ?
    `;
        const params = [filter.businessId];
        if (filter.branchId) {
            sql += ' AND r.branch_id = ?';
            params.push(filter.branchId);
        }
        if (filter.status) {
            sql += ' AND r.status = ?';
            params.push(filter.status);
        }
        if (filter.customerId) {
            sql += ' AND r.customer_id = ?';
            params.push(filter.customerId);
        }
        if (filter.sourceType) {
            sql += ' AND r.source_type = ?';
            params.push(filter.sourceType);
        }
        if (filter.search) {
            sql += ' AND (r.reservation_number LIKE ? OR c.name LIKE ?)';
            params.push(`%${filter.search}%`, `%${filter.search}%`);
        }
        sql += ' ORDER BY r.created_at DESC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => ({
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            reservationNumber: row.reservation_number,
            customerId: row.customer_id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            status: row.status,
            reservedAt: row.reserved_at,
            expiresAt: row.expires_at,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            customerName: row.customer_name,
            branchName: row.branch_name,
            creatorName: row.creator_name,
            lines: this.getLinesByReservationId(row.id)
        }));
    }
    /**
     * Updates status and optional timestamp fields of a reservation.
     */
    updateStatus(id, status, options = {}) {
        const updatedAt = options.updatedAt || new Date().toISOString();
        let sql = 'UPDATE stock_reservations SET status = ?, updated_at = ?';
        const params = [status, updatedAt];
        if (options.expiresAt !== undefined) {
            sql += ', expires_at = ?';
            params.push(options.expiresAt);
        }
        if (options.reservedAt !== undefined) {
            sql += ', reserved_at = ?';
            params.push(options.reservedAt);
        }
        sql += ' WHERE id = ?';
        params.push(id);
        this.db.prepare(sql).run(...params);
    }
    /**
     * Updates fulfilled or released quantity for a line.
     */
    updateLineQuantities(lineId, fulfilledDeltaScaled, releasedDeltaScaled) {
        this.db.prepare(`
      UPDATE stock_reservation_lines
      SET fulfilled_quantity_scaled = fulfilled_quantity_scaled + ?,
          released_quantity_scaled = released_quantity_scaled + ?
      WHERE id = ?
    `).run(fulfilledDeltaScaled, releasedDeltaScaled, lineId);
    }
    /**
     * Updates expiration timestamp.
     */
    updateExpiration(reservationId, expiresAt) {
        this.db.prepare(`
      UPDATE stock_reservations
      SET expires_at = ?,
          status = CASE WHEN status = 'expired' THEN 'active' ELSE status END,
          updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      WHERE id = ?
    `).run(expiresAt, reservationId);
    }
    /**
     * Finds all reservations past expires_at that are still marked 'active' or 'partially_fulfilled'.
     */
    findExpiredActiveReservations(businessId, now = new Date().toISOString()) {
        let sql = `
      SELECT id FROM stock_reservations
      WHERE status IN ('active', 'partially_fulfilled')
        AND expires_at IS NOT NULL
        AND expires_at < ?
    `;
        const params = [now];
        if (businessId) {
            sql += ' AND business_id = ?';
            params.push(businessId);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => this.findById(r.id));
    }
    /**
     * Calculates total active unfulfilled reserved quantity for a specific product and location.
     */
    getActiveReservedQuantity(productId, stockLocationId, businessId, variantId) {
        let sql = `
      SELECT SUM(l.reserved_quantity_scaled - l.fulfilled_quantity_scaled - l.released_quantity_scaled) as active_reserved
      FROM stock_reservation_lines l
      JOIN stock_reservations r ON l.reservation_id = r.id
      WHERE r.business_id = ?
        AND l.product_id = ?
        AND l.stock_location_id = ?
        AND r.status IN ('active', 'partially_fulfilled')
    `;
        const params = [businessId, String(productId), stockLocationId];
        if (variantId) {
            sql += ' AND l.variant_id = ?';
            params.push(String(variantId));
        }
        else {
            sql += ' AND l.variant_id IS NULL';
        }
        const row = this.db.prepare(sql).get(...params);
        return Number(row?.active_reserved || 0);
    }
}
exports.StockReservationRepository = StockReservationRepository;
