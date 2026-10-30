import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import {
  StockReservation,
  StockReservationLine,
  StockReservationStatus,
  ReservationFilter
} from '../../../shared/types/stock-reservation';

export class StockReservationRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Atomically persists a reservation and its child lines.
   */
  public create(
    reservation: StockReservation,
    lines: StockReservationLine[]
  ): StockReservation {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO stock_reservations (
          id, business_id, branch_id, reservation_number, customer_id,
          source_type, source_id, status, reserved_at, expires_at,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reservation.id,
        reservation.businessId,
        reservation.branchId,
        reservation.reservationNumber,
        reservation.customerId || null,
        reservation.sourceType,
        reservation.sourceId || null,
        reservation.status,
        reservation.reservedAt || null,
        reservation.expiresAt || null,
        reservation.createdBy,
        reservation.createdAt,
        reservation.updatedAt
      );

      const insertLine = this.db.prepare(`
        INSERT INTO stock_reservation_lines (
          id, reservation_id, product_id, variant_id, stock_location_id,
          batch_id, reserved_quantity_scaled, fulfilled_quantity_scaled,
          released_quantity_scaled, unit_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        insertLine.run(
          line.id,
          line.reservationId,
          String(line.productId),
          line.variantId ? String(line.variantId) : null,
          line.stockLocationId,
          line.batchId ? String(line.batchId) : null,
          line.reservedQuantityScaled,
          line.fulfilledQuantityScaled || 0,
          line.releasedQuantityScaled || 0,
          line.unitId ? String(line.unitId) : null,
          reservation.createdAt
        );
      }
    });

    tx();
    return this.findById(reservation.id)!;
  }

  /**
   * Retrieves a single reservation with its lines and joined details.
   */
  public findById(id: string): StockReservation | null {
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
    `).get(id) as any;

    if (!row) return null;

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
  public findByReservationNumber(reservationNumber: string): StockReservation | null {
    const row = this.db.prepare(`
      SELECT id FROM stock_reservations WHERE reservation_number = ?
    `).get(reservationNumber) as { id: string } | undefined;

    return row ? this.findById(row.id) : null;
  }

  /**
   * Retrieves lines belonging to a reservation.
   */
  public getLinesByReservationId(reservationId: string): StockReservationLine[] {
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
    `).all(reservationId) as any[];

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
  public list(filter: ReservationFilter): StockReservation[] {
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
    const params: any[] = [filter.businessId];

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

    const rows = this.db.prepare(sql).all(...params) as any[];

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
  public updateStatus(
    id: string,
    status: StockReservationStatus,
    options: { reservedAt?: string; expiresAt?: string; updatedAt?: string } = {}
  ): void {
    const updatedAt = options.updatedAt || new Date().toISOString();
    let sql = 'UPDATE stock_reservations SET status = ?, updated_at = ?';
    const params: any[] = [status, updatedAt];

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
  public updateLineQuantities(
    lineId: string,
    fulfilledDeltaScaled: number,
    releasedDeltaScaled: number
  ): void {
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
  public updateExpiration(reservationId: string, expiresAt: string): void {
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
  public findExpiredActiveReservations(
    businessId?: string,
    now: string = new Date().toISOString()
  ): StockReservation[] {
    let sql = `
      SELECT id FROM stock_reservations
      WHERE status IN ('active', 'partially_fulfilled')
        AND expires_at IS NOT NULL
        AND expires_at < ?
    `;
    const params: any[] = [now];

    if (businessId) {
      sql += ' AND business_id = ?';
      params.push(businessId);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{ id: string }>;
    return rows.map((r) => this.findById(r.id)!);
  }

  /**
   * Calculates total active unfulfilled reserved quantity for a specific product and location.
   */
  public getActiveReservedQuantity(
    productId: string | number,
    stockLocationId: string,
    businessId: string,
    variantId?: string | number | null
  ): number {
    let sql = `
      SELECT SUM(l.reserved_quantity_scaled - l.fulfilled_quantity_scaled - l.released_quantity_scaled) as active_reserved
      FROM stock_reservation_lines l
      JOIN stock_reservations r ON l.reservation_id = r.id
      WHERE r.business_id = ?
        AND l.product_id = ?
        AND l.stock_location_id = ?
        AND r.status IN ('active', 'partially_fulfilled')
    `;
    const params: any[] = [businessId, String(productId), stockLocationId];

    if (variantId) {
      sql += ' AND l.variant_id = ?';
      params.push(String(variantId));
    } else {
      sql += ' AND l.variant_id IS NULL';
    }

    const row = this.db.prepare(sql).get(...params) as { active_reserved: number | null } | undefined;
    return Number(row?.active_reserved || 0);
  }
}
