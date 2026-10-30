import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../connection';
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseOrderSettings,
  PurchaseOrderFilterQuery,
  OutstandingDeliveryReportItem
} from '../../../shared/types/purchase-order';

export class PurchaseOrderRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  // =========================================================================
  // 1. SETTINGS
  // =========================================================================

  public getSettings(businessId: string): PurchaseOrderSettings | null {
    const row = this.db.prepare(`
      SELECT * FROM purchase_order_settings WHERE business_id = ?
    `).get(businessId) as any;

    if (!row) return null;

    return {
      id: row.id,
      businessId: row.business_id,
      overDeliveryPolicy: row.over_delivery_policy,
      overDeliveryTolerancePercent: Number(row.over_delivery_tolerance_percent || 0),
      requireApprovalAboveMinor: Number(row.require_approval_above_minor || 10000000),
      allowSelfApproval: Boolean(row.allow_self_approval),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public upsertSettings(businessId: string, settings: Partial<PurchaseOrderSettings>): PurchaseOrderSettings {
    const existing = this.getSettings(businessId);
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE purchase_order_settings
        SET over_delivery_policy = ?,
            over_delivery_tolerance_percent = ?,
            require_approval_above_minor = ?,
            allow_self_approval = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        settings.overDeliveryPolicy || existing.overDeliveryPolicy,
        settings.overDeliveryTolerancePercent !== undefined ? settings.overDeliveryTolerancePercent : existing.overDeliveryTolerancePercent,
        settings.requireApprovalAboveMinor !== undefined ? settings.requireApprovalAboveMinor : existing.requireApprovalAboveMinor,
        settings.allowSelfApproval !== undefined ? (settings.allowSelfApproval ? 1 : 0) : (existing.allowSelfApproval ? 1 : 0),
        now,
        existing.id
      );
      return this.getSettings(businessId)!;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO purchase_order_settings (
        id, business_id, over_delivery_policy, over_delivery_tolerance_percent,
        require_approval_above_minor, allow_self_approval, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      businessId,
      settings.overDeliveryPolicy || 'reject',
      settings.overDeliveryTolerancePercent || 0,
      settings.requireApprovalAboveMinor !== undefined ? settings.requireApprovalAboveMinor : 10000000,
      settings.allowSelfApproval ? 1 : 0,
      now,
      now
    );

    return this.getSettings(businessId)!;
  }

  // =========================================================================
  // 2. PURCHASE ORDERS & LINES
  // =========================================================================

  private mapRowToOrder(row: any, lines: PurchaseOrderLine[] = []): PurchaseOrder {
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      branchName: row.branch_name,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      supplierCode: row.supplier_code,
      purchaseOrderNumber: row.purchase_order_number,
      orderDate: row.order_date,
      expectedDeliveryDate: row.expected_delivery_date,
      currencyCode: row.currency_code,
      exchangeRateNumerator: Number(row.exchange_rate_numerator || 1),
      exchangeRateDenominator: Number(row.exchange_rate_denominator || 1),
      subtotalMinor: Number(row.subtotal_minor || 0),
      discountMinor: Number(row.discount_minor || 0),
      taxMinor: Number(row.tax_minor || 0),
      shippingMinor: Number(row.shipping_minor || 0),
      otherChargesMinor: Number(row.other_charges_minor || 0),
      totalMinor: Number(row.total_minor || 0),
      status: row.status as PurchaseOrderStatus,
      paymentTermsDays: Number(row.payment_terms_days || 0),
      notes: row.notes,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by_name,
      approvedAt: row.approved_at,
      sentAt: row.sent_at,
      closedAt: row.closed_at,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines
    };
  }

  private mapRowToLine(row: any): PurchaseOrderLine {
    const ordered = Number(row.ordered_quantity_scaled || 0);
    const received = Number(row.received_quantity_scaled || 0);
    const invoiced = Number(row.invoiced_quantity_scaled || 0);

    return {
      id: row.id,
      purchaseOrderId: row.purchase_order_id,
      productId: row.product_id,
      productName: row.product_name,
      productSku: row.product_sku,
      variantId: row.variant_id,
      orderedQuantityScaled: ordered,
      receivedQuantityScaled: received,
      invoicedQuantityScaled: invoiced,
      purchaseUnitId: row.purchase_unit_id,
      purchaseUnitName: row.purchase_unit_name,
      conversionNumerator: Number(row.conversion_numerator || 1),
      conversionDenominator: Number(row.conversion_denominator || 1),
      baseQuantityScaled: Number(row.base_quantity_scaled || 0),
      unitPriceMinor: Number(row.unit_price_minor || 0),
      lineDiscountMinor: Number(row.line_discount_minor || 0),
      taxProfileId: row.tax_profile_id,
      taxMinor: Number(row.tax_minor || 0),
      lineTotalMinor: Number(row.line_total_minor || 0),
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      outstandingQuantityScaled: Math.max(0, ordered - received),
      uninvoicedQuantityScaled: Math.max(0, received - invoiced)
    };
  }

  public getLines(poId: string): PurchaseOrderLine[] {
    const rows = this.db.prepare(`
      SELECT pol.*, p.name as product_name, p.sku as product_sku, u.name as purchase_unit_name
      FROM purchase_order_lines pol
      JOIN products p ON p.id = pol.product_id
      LEFT JOIN units u ON u.id = pol.purchase_unit_id
      WHERE pol.purchase_order_id = ?
      ORDER BY pol.created_at ASC
    `).all(poId) as any[];

    return rows.map((r) => this.mapRowToLine(r));
  }

  public findById(id: string, businessId?: string): PurchaseOrder | null {
    let sql = `
      SELECT po.*, s.name as supplier_name, s.supplier_code, b.name as branch_name,
             u1.full_name as created_by_name, u2.full_name as approved_by_name
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN branches b ON b.id = po.branch_id
      LEFT JOIN users u1 ON CAST(u1.id AS TEXT) = po.created_by
      LEFT JOIN users u2 ON CAST(u2.id AS TEXT) = po.approved_by
      WHERE po.id = ?
    `;
    const params: any[] = [id];
    if (businessId) {
      sql += ' AND po.business_id = ?';
      params.push(businessId);
    }

    const row = this.db.prepare(sql).get(...params) as any;
    if (!row) return null;

    const lines = this.getLines(row.id);
    return this.mapRowToOrder(row, lines);
  }

  public findByOrderNumber(businessId: string, poNumber: string): PurchaseOrder | null {
    const row = this.db.prepare(`
      SELECT po.*, s.name as supplier_name, s.supplier_code, b.name as branch_name
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN branches b ON b.id = po.branch_id
      WHERE po.business_id = ? AND UPPER(po.purchase_order_number) = UPPER(?)
    `).get(businessId, poNumber.trim()) as any;

    if (!row) return null;
    const lines = this.getLines(row.id);
    return this.mapRowToOrder(row, lines);
  }

  public findByIdempotencyKey(businessId: string, idempotencyKey: string): PurchaseOrder | null {
    const row = this.db.prepare(`
      SELECT po.*, s.name as supplier_name, s.supplier_code, b.name as branch_name
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN branches b ON b.id = po.branch_id
      WHERE po.business_id = ? AND po.idempotency_key = ?
    `).get(businessId, idempotencyKey) as any;

    if (!row) return null;
    const lines = this.getLines(row.id);
    return this.mapRowToOrder(row, lines);
  }

  public create(
    order: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt' | 'lines'>,
    lines: Array<Omit<PurchaseOrderLine, 'id' | 'purchaseOrderId' | 'createdAt' | 'updatedAt'>>
  ): PurchaseOrder {
    const id = randomUUID();
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      // 1. Insert header
      this.db.prepare(`
        INSERT INTO purchase_orders (
          id, business_id, branch_id, supplier_id, purchase_order_number, invoice_number,
          order_date, expected_delivery_date, currency_code, exchange_rate_numerator,
          exchange_rate_denominator, subtotal_minor, discount_minor, tax_minor,
          shipping_minor, other_charges_minor, total_minor, subtotal, grand_total,
          status, payment_terms_days, notes, created_by, approved_by, approved_at,
          sent_at, closed_at, idempotency_key, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `).run(
        id,
        order.businessId,
        order.branchId,
        order.supplierId,
        order.purchaseOrderNumber.trim(),
        order.purchaseOrderNumber.trim(), // sync invoice_number
        order.orderDate || now,
        order.expectedDeliveryDate || null,
        order.currencyCode || 'PKR',
        order.exchangeRateNumerator || 1,
        order.exchangeRateDenominator || 1,
        order.subtotalMinor,
        order.discountMinor,
        order.taxMinor,
        order.shippingMinor,
        order.otherChargesMinor,
        order.totalMinor,
        order.subtotalMinor,
        order.totalMinor,
        order.status || 'draft',
        order.paymentTermsDays || 0,
        order.notes || null,
        String(order.createdBy || '1'),
        order.approvedBy ? String(order.approvedBy) : null,
        order.approvedAt || null,
        order.sentAt || null,
        order.closedAt || null,
        order.idempotencyKey,
        now,
        now
      );

      // 2. Insert lines
      const lineInsert = this.db.prepare(`
        INSERT INTO purchase_order_lines (
          id, purchase_order_id, product_id, variant_id, ordered_quantity_scaled,
          received_quantity_scaled, invoiced_quantity_scaled, purchase_unit_id,
          conversion_numerator, conversion_denominator, base_quantity_scaled,
          unit_price_minor, line_discount_minor, tax_profile_id, tax_minor,
          line_total_minor, notes, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `);

      for (const line of lines) {
        const lineId = randomUUID();
        lineInsert.run(
          lineId,
          id,
          String(line.productId),
          line.variantId ? String(line.variantId) : null,
          line.orderedQuantityScaled,
          line.receivedQuantityScaled || 0,
          line.invoicedQuantityScaled || 0,
          String(line.purchaseUnitId),
          line.conversionNumerator || 1,
          line.conversionDenominator || 1,
          line.baseQuantityScaled,
          line.unitPriceMinor,
          line.lineDiscountMinor || 0,
          line.taxProfileId || null,
          line.taxMinor || 0,
          line.lineTotalMinor,
          line.notes || null,
          now,
          now
        );
      }
    });

    tx();
    return this.findById(id)!;
  }

  public updateStatus(
    id: string,
    status: PurchaseOrderStatus,
    metadata?: {
      approvedBy?: string;
      approvedAt?: string;
      sentAt?: string;
      closedAt?: string;
    }
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE purchase_orders
      SET status = ?,
          approved_by = COALESCE(?, approved_by),
          approved_at = COALESCE(?, approved_at),
          sent_at = COALESCE(?, sent_at),
          closed_at = COALESCE(?, closed_at),
          updated_at = ?
      WHERE id = ?
    `).run(
      status,
      metadata?.approvedBy || null,
      metadata?.approvedAt || null,
      metadata?.sentAt || null,
      metadata?.closedAt || null,
      now,
      id
    );
  }

  public updateLineQuantities(
    lineId: string,
    receivedDeltaScaled: number,
    invoicedDeltaScaled: number
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE purchase_order_lines
      SET received_quantity_scaled = received_quantity_scaled + ?,
          invoiced_quantity_scaled = invoiced_quantity_scaled + ?,
          updated_at = ?
      WHERE id = ?
    `).run(receivedDeltaScaled, invoicedDeltaScaled, now, lineId);
  }

  public getLastPurchasePrice(
    businessId: string,
    supplierId: string | number,
    productId: string | number
  ): number | null {
    const row = this.db.prepare(`
      SELECT pol.unit_price_minor
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.business_id = ? AND po.supplier_id = ? AND pol.product_id = ?
      ORDER BY po.order_date DESC, po.created_at DESC
      LIMIT 1
    `).get(businessId, String(supplierId), String(productId)) as any;

    return row != null ? Number(row.unit_price_minor) : null;
  }

  public search(query: PurchaseOrderFilterQuery): { orders: PurchaseOrder[]; total: number } {
    let sql = `
      SELECT po.*, s.name as supplier_name, s.supplier_code, b.name as branch_name
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN branches b ON b.id = po.branch_id
      WHERE po.business_id = ?
    `;
    const params: any[] = [query.businessId];

    if (query.branchId) {
      sql += ' AND po.branch_id = ?';
      params.push(query.branchId);
    }

    if (query.supplierId) {
      sql += ' AND po.supplier_id = ?';
      params.push(String(query.supplierId));
    }

    if (query.status) {
      if (Array.isArray(query.status)) {
        const placeholders = query.status.map(() => '?').join(',');
        sql += ` AND po.status IN (${placeholders})`;
        params.push(...query.status);
      } else {
        sql += ' AND po.status = ?';
        params.push(query.status);
      }
    }

    if (query.search && query.search.trim()) {
      const q = `%${query.search.trim()}%`;
      sql += ' AND (po.purchase_order_number LIKE ? OR s.name LIKE ? OR s.supplier_code LIKE ?)';
      params.push(q, q, q);
    }

    if (query.startDate) {
      sql += ' AND po.order_date >= ?';
      params.push(query.startDate);
    }

    if (query.endDate) {
      sql += ' AND po.order_date <= ?';
      params.push(query.endDate);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM (${sql})`).get(...params) as { total: number };
    const total = countRow?.total || 0;

    sql += ' ORDER BY po.order_date DESC, po.created_at DESC';

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.max(1, query.pageSize || 50);
    const offset = (page - 1) * pageSize;
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const rows = this.db.prepare(sql).all(...params) as any[];
    const orders = rows.map((r) => this.mapRowToOrder(r, []));

    return { orders, total };
  }

  public getOutstandingDeliveryReport(
    businessId: string,
    supplierId?: string
  ): OutstandingDeliveryReportItem[] {
    let sql = `
      SELECT
        po.id as purchase_order_id,
        po.purchase_order_number,
        po.order_date,
        po.expected_delivery_date,
        s.id as supplier_id,
        s.name as supplier_name,
        p.id as product_id,
        p.name as product_name,
        COALESCE(u.name, 'Piece') as purchase_unit_name,
        pol.ordered_quantity_scaled,
        pol.received_quantity_scaled,
        (pol.ordered_quantity_scaled - pol.received_quantity_scaled) as outstanding_quantity_scaled,
        pol.unit_price_minor
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN products p ON p.id = pol.product_id
      LEFT JOIN units u ON u.id = pol.purchase_unit_id
      WHERE po.business_id = ?
        AND po.status IN ('approved', 'sent', 'partially_received')
        AND (pol.ordered_quantity_scaled - pol.received_quantity_scaled) > 0
    `;
    const params: any[] = [businessId];

    if (supplierId) {
      sql += ' AND po.supplier_id = ?';
      params.push(supplierId);
    }

    sql += ' ORDER BY po.expected_delivery_date ASC, po.order_date ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    const now = new Date().toISOString().substring(0, 10);

    return rows.map((r) => {
      const outstandingScaled = Number(r.outstanding_quantity_scaled || 0);
      const unitPrice = Number(r.unit_price_minor || 0);
      const outstandingValue = Math.round((outstandingScaled / 1000) * unitPrice);
      const isOverdue = Boolean(r.expected_delivery_date && r.expected_delivery_date < now);

      return {
        purchaseOrderId: r.purchase_order_id,
        purchaseOrderNumber: r.purchase_order_number,
        orderDate: r.order_date,
        expectedDeliveryDate: r.expected_delivery_date,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        productId: r.product_id,
        productName: r.product_name,
        purchaseUnitName: r.purchase_unit_name,
        orderedQuantityScaled: Number(r.ordered_quantity_scaled || 0),
        receivedQuantityScaled: Number(r.received_quantity_scaled || 0),
        outstandingQuantityScaled: outstandingScaled,
        unitPriceMinor: unitPrice,
        outstandingValueMinor: outstandingValue,
        isOverdue
      };
    });
  }
}

