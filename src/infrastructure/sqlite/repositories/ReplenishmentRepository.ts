import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../connection';
import {
  ProductReorderRule,
  ReplenishmentSuggestion,
  ReplenishmentSuggestionStatus,
  UpsertReorderRuleDto,
  SuggestionListFilter,
  CalculationReason
} from '../../../shared/types/stock-replenishment';

export class ReplenishmentRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Upserts a product reorder rule.
   * If stockLocationId is omitted, applies as default rule for product across locations.
   */
  public upsertReorderRule(dto: UpsertReorderRuleDto): ProductReorderRule {
    const locId = dto.stockLocationId ? String(dto.stockLocationId) : null;
    const prodId = String(dto.productId);
    const now = new Date().toISOString();

    const existing = this.getReorderRule(prodId, locId, dto.businessId);

    if (existing) {
      this.db.prepare(`
        UPDATE product_reorder_rules
        SET minimum_stock_scaled = ?,
            reorder_point_scaled = ?,
            target_stock_scaled = ?,
            preferred_supplier_id = ?,
            preferred_purchase_unit_id = ?,
            lead_time_days = ?,
            safety_stock_scaled = ?,
            is_active = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        dto.minimumStockScaled,
        dto.reorderPointScaled !== undefined ? dto.reorderPointScaled : dto.minimumStockScaled,
        dto.targetStockScaled,
        dto.preferredSupplierId ? String(dto.preferredSupplierId) : null,
        dto.preferredPurchaseUnitId ? String(dto.preferredPurchaseUnitId) : null,
        dto.leadTimeDays || 0,
        dto.safetyStockScaled || 0,
        dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : 1,
        now,
        existing.id
      );

      return this.getReorderRule(prodId, locId, dto.businessId)!;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO product_reorder_rules (
        id, business_id, product_id, stock_location_id,
        minimum_stock_scaled, reorder_point_scaled, target_stock_scaled,
        preferred_supplier_id, preferred_purchase_unit_id, lead_time_days,
        safety_stock_scaled, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      dto.businessId,
      prodId,
      locId,
      dto.minimumStockScaled,
      dto.reorderPointScaled !== undefined ? dto.reorderPointScaled : dto.minimumStockScaled,
      dto.targetStockScaled,
      dto.preferredSupplierId ? String(dto.preferredSupplierId) : null,
      dto.preferredPurchaseUnitId ? String(dto.preferredPurchaseUnitId) : null,
      dto.leadTimeDays || 0,
      dto.safetyStockScaled || 0,
      dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : 1,
      now,
      now
    );

    return this.getReorderRule(prodId, locId, dto.businessId)!;
  }

  /**
   * Retrieves rule for product and location (falls back to location-agnostic rule if specific is null).
   */
  public getReorderRule(
    productId: string | number,
    stockLocationId: string | null | undefined,
    businessId: string
  ): ProductReorderRule | null {
    const prodId = String(productId);

    // 1. Try location-specific rule first
    if (stockLocationId) {
      const row = this.db.prepare(`
        SELECT r.*,
               p.name as product_name, p.sku,
               l.name as location_name,
               s.name as supplier_name,
               u.name as purchase_unit_name
        FROM product_reorder_rules r
        JOIN products p ON r.product_id = p.id
        LEFT JOIN stock_locations l ON r.stock_location_id = l.id
        LEFT JOIN suppliers s ON r.preferred_supplier_id = s.id
        LEFT JOIN units u ON r.preferred_purchase_unit_id = u.id
        WHERE r.business_id = ? AND r.product_id = ? AND r.stock_location_id = ?
      `).get(businessId, prodId, stockLocationId) as any;

      if (row) return this.mapRuleRow(row);
    }

    // 2. Fall back to location-agnostic default rule
    const generalRow = this.db.prepare(`
      SELECT r.*,
             p.name as product_name, p.sku,
             l.name as location_name,
             s.name as supplier_name,
             u.name as purchase_unit_name
      FROM product_reorder_rules r
      JOIN products p ON r.product_id = p.id
      LEFT JOIN stock_locations l ON r.stock_location_id = l.id
      LEFT JOIN suppliers s ON r.preferred_supplier_id = s.id
      LEFT JOIN units u ON r.preferred_purchase_unit_id = u.id
      WHERE r.business_id = ? AND r.product_id = ? AND r.stock_location_id IS NULL
    `).get(businessId, prodId) as any;

    return generalRow ? this.mapRuleRow(generalRow) : null;
  }

  /**
   * Lists reorder rules for a business.
   */
  public listReorderRules(businessId: string, locationId?: string): ProductReorderRule[] {
    let sql = `
      SELECT r.*,
             p.name as product_name, p.sku,
             l.name as location_name,
             s.name as supplier_name,
             u.name as purchase_unit_name
      FROM product_reorder_rules r
      JOIN products p ON r.product_id = p.id
      LEFT JOIN stock_locations l ON r.stock_location_id = l.id
      LEFT JOIN suppliers s ON r.preferred_supplier_id = s.id
      LEFT JOIN units u ON r.preferred_purchase_unit_id = u.id
      WHERE r.business_id = ?
    `;
    const params: any[] = [businessId];

    if (locationId) {
      sql += ' AND (r.stock_location_id = ? OR r.stock_location_id IS NULL)';
      params.push(locationId);
    }

    sql += ' ORDER BY p.name ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRuleRow(r));
  }

  /**
   * Persists or updates a replenishment suggestion.
   */
  public saveSuggestion(sugg: {
    id?: string;
    businessId: string;
    branchId: string;
    productId: string | number;
    stockLocationId: string;
    suggestedQuantityScaled: number;
    currentAvailableScaled: number;
    targetStockScaled: number;
    calculationReason: CalculationReason;
    status?: ReplenishmentSuggestionStatus;
  }): ReplenishmentSuggestion {
    const now = new Date().toISOString();
    const reasonJson = JSON.stringify(sugg.calculationReason);
    const prodId = String(sugg.productId);

    const existing = this.findOpenSuggestion(prodId, sugg.stockLocationId, sugg.businessId);

    if (existing) {
      this.db.prepare(`
        UPDATE replenishment_suggestions
        SET suggested_quantity_scaled = ?,
            current_available_scaled = ?,
            target_stock_scaled = ?,
            calculation_reason = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        sugg.suggestedQuantityScaled,
        sugg.currentAvailableScaled,
        sugg.targetStockScaled,
        reasonJson,
        now,
        existing.id
      );

      return this.findById(existing.id)!;
    }

    const id = sugg.id || randomUUID();
    this.db.prepare(`
      INSERT INTO replenishment_suggestions (
        id, business_id, branch_id, product_id, stock_location_id,
        suggested_quantity_scaled, current_available_scaled, target_stock_scaled,
        calculation_reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sugg.businessId,
      sugg.branchId,
      prodId,
      sugg.stockLocationId,
      sugg.suggestedQuantityScaled,
      sugg.currentAvailableScaled,
      sugg.targetStockScaled,
      reasonJson,
      sugg.status || 'open',
      now,
      now
    );

    return this.findById(id)!;
  }

  /**
   * Finds an existing open suggestion for a product and location to prevent spamming duplicate records.
   */
  public findOpenSuggestion(
    productId: string | number,
    stockLocationId: string,
    businessId: string
  ): ReplenishmentSuggestion | null {
    const row = this.db.prepare(`
      SELECT * FROM replenishment_suggestions
      WHERE business_id = ? AND product_id = ? AND stock_location_id = ? AND status = 'open'
    `).get(businessId, String(productId), stockLocationId) as any;

    return row ? this.findById(row.id) : null;
  }

  /**
   * Finds suggestion by ID.
   */
  public findById(id: string): ReplenishmentSuggestion | null {
    const row = this.db.prepare(`
      SELECT s.*,
             p.name as product_name, p.sku,
             l.name as location_name,
             b.name as branch_name,
             r.preferred_supplier_id,
             sup.name as preferred_supplier_name
      FROM replenishment_suggestions s
      JOIN products p ON s.product_id = p.id
      JOIN stock_locations l ON s.stock_location_id = l.id
      JOIN branches b ON s.branch_id = b.id
      LEFT JOIN product_reorder_rules r ON r.product_id = s.product_id AND r.business_id = s.business_id
      LEFT JOIN suppliers sup ON r.preferred_supplier_id = sup.id
      WHERE s.id = ?
    `).get(id) as any;

    return row ? this.mapSuggestionRow(row) : null;
  }

  /**
   * Lists replenishment suggestions.
   */
  public listSuggestions(filter: SuggestionListFilter): ReplenishmentSuggestion[] {
    let sql = `
      SELECT s.*,
             p.name as product_name, p.sku,
             l.name as location_name,
             b.name as branch_name,
             r.preferred_supplier_id,
             sup.name as preferred_supplier_name
      FROM replenishment_suggestions s
      JOIN products p ON s.product_id = p.id
      JOIN stock_locations l ON s.stock_location_id = l.id
      JOIN branches b ON s.branch_id = b.id
      LEFT JOIN product_reorder_rules r ON r.product_id = s.product_id AND r.business_id = s.business_id
      LEFT JOIN suppliers sup ON r.preferred_supplier_id = sup.id
      WHERE s.business_id = ?
    `;
    const params: any[] = [filter.businessId];

    if (filter.branchId) {
      sql += ' AND s.branch_id = ?';
      params.push(filter.branchId);
    }
    if (filter.stockLocationId) {
      sql += ' AND s.stock_location_id = ?';
      params.push(filter.stockLocationId);
    }
    if (filter.supplierId) {
      sql += ' AND r.preferred_supplier_id = ?';
      params.push(String(filter.supplierId));
    }
    if (filter.status) {
      sql += ' AND s.status = ?';
      params.push(filter.status);
    }
    if (filter.search) {
      sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR sup.name LIKE ?)';
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }

    sql += ' ORDER BY s.created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapSuggestionRow(r));
  }

  /**
   * Updates status of suggestion.
   */
  public updateSuggestionStatus(
    id: string,
    status: ReplenishmentSuggestionStatus,
    updatedQuantityScaled?: number
  ): void {
    const now = new Date().toISOString();
    let sql = 'UPDATE replenishment_suggestions SET status = ?, updated_at = ?';
    const params: any[] = [status, now];

    if (updatedQuantityScaled !== undefined) {
      sql += ', suggested_quantity_scaled = ?';
      params.push(updatedQuantityScaled);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    this.db.prepare(sql).run(...params);
  }

  /**
   * Queries net sales demand history for a product in an analysis period.
   * Net demand = (Sale Lines - Return Lines).
   * Excludes cancelled or voided transactions.
   */
  public getNetSalesQuantity(
    productId: string | number,
    businessId: string,
    locationId?: string,
    sinceIso?: string
  ): { totalNetQuantityScaled: number; daysWithSales: number; maxSingleDaySaleScaled: number } {
    let sql = `
      SELECT DATE(s.created_at) as sale_date,
             SUM(i.quantity * i.conversion_factor * 1000) as daily_qty_scaled
      FROM sale_items i
      JOIN sales s ON i.sale_id = s.id
      WHERE i.product_id = ? AND s.status = 'COMPLETED'
    `;
    const params: any[] = [String(productId)];

    if (sinceIso) {
      sql += ' AND s.created_at >= ?';
      params.push(sinceIso);
    }

    sql += ' GROUP BY DATE(s.created_at)';

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{ sale_date: string; daily_qty_scaled: number }>;

      const daysWithSales = rows.length;
      let total = 0;
      let maxDay = 0;

      for (const r of rows) {
        const qty = Number(r.daily_qty_scaled) || 0;
        total += qty;
        if (qty > maxDay) maxDay = qty;
      }

      return {
        totalNetQuantityScaled: total,
        daysWithSales,
        maxSingleDaySaleScaled: maxDay
      };
    } catch {
      return { totalNetQuantityScaled: 0, daysWithSales: 0, maxSingleDaySaleScaled: 0 };
    }
  }

  /**
   * Calculates in-transit stock incoming to destination location from active dispatches.
   */
  public getInTransitIncomingScaled(
    productId: string | number,
    destinationLocationId: string,
    businessId: string
  ): number {
    try {
      const row = this.db.prepare(`
        SELECT SUM(l.quantity_scaled - l.received_quantity_scaled - l.rejected_quantity_scaled) as in_transit
        FROM stock_transfer_lines l
        JOIN stock_transfers t ON l.transfer_id = t.id
        WHERE t.business_id = ?
          AND l.product_id = ?
          AND t.destination_location_id = ?
          AND t.status IN ('dispatched', 'partially_received')
      `).get(businessId, String(productId), destinationLocationId) as { in_transit: number | null } | undefined;

      return Number(row?.in_transit || 0);
    } catch {
      return 0;
    }
  }

  /**
   * Calculates pending purchase order quantity on order for a product.
   */
  public getOnOrderPoQuantityScaled(
    productId: string | number,
    businessId: string
  ): number {
    try {
      const row = this.db.prepare(`
        SELECT SUM(poi.quantity * poi.conversion_factor * 1000) as on_order
        FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.purchase_order_id = po.id
        WHERE poi.product_id = ? AND po.status = 'DRAFT'
      `).get(String(productId)) as { on_order: number | null } | undefined;

      return Number(row?.on_order || 0);
    } catch {
      return 0;
    }
  }

  private mapRuleRow(r: any): ProductReorderRule {
    return {
      id: r.id,
      businessId: r.business_id,
      productId: r.product_id,
      stockLocationId: r.stock_location_id,
      minimumStockScaled: Number(r.minimum_stock_scaled),
      reorderPointScaled: Number(r.reorder_point_scaled),
      targetStockScaled: Number(r.target_stock_scaled),
      preferredSupplierId: r.preferred_supplier_id,
      preferredPurchaseUnitId: r.preferred_purchase_unit_id,
      leadTimeDays: Number(r.lead_time_days),
      safetyStockScaled: Number(r.safety_stock_scaled),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      productName: r.product_name,
      sku: r.sku,
      locationName: r.location_name,
      supplierName: r.supplier_name,
      purchaseUnitName: r.purchase_unit_name
    };
  }

  private mapSuggestionRow(r: any): ReplenishmentSuggestion {
    let reason: CalculationReason;
    try {
      reason = JSON.parse(r.calculation_reason);
    } catch {
      reason = {
        method: 'SIMPLE_REORDER',
        analysisPeriodDays: 30,
        averageDailyDemand: 0,
        leadTimeDays: 0,
        safetyStock: 0,
        reorderPoint: 0,
        targetStock: Number(r.target_stock_scaled) / 1000,
        onHand: Number(r.current_available_scaled) / 1000,
        reserved: 0,
        available: Number(r.current_available_scaled) / 1000,
        projectedAvailable: Number(r.current_available_scaled) / 1000,
        rawShortfall: Number(r.suggested_quantity_scaled) / 1000,
        suggestedQuantity: Number(r.suggested_quantity_scaled) / 1000,
        confidence: 'MEDIUM',
        explanation: 'Legacy suggestion'
      };
    }

    return {
      id: r.id,
      businessId: r.business_id,
      branchId: r.branch_id,
      productId: r.product_id,
      stockLocationId: r.stock_location_id,
      suggestedQuantityScaled: Number(r.suggested_quantity_scaled),
      currentAvailableScaled: Number(r.current_available_scaled),
      targetStockScaled: Number(r.target_stock_scaled),
      calculationReason: reason,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      productName: r.product_name,
      sku: r.sku,
      locationName: r.location_name,
      branchName: r.branch_name,
      preferredSupplierId: r.preferred_supplier_id,
      preferredSupplierName: r.preferred_supplier_name
    };
  }
}

