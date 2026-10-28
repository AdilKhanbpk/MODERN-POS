import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { PurchaseOrder, PurchaseOrderItemInput, PurchaseLine, SupplierReturn } from '../../../shared/types';

export class PurchaseRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public create(po: {
    supplierId: number;
    invoiceNumber: string;
    locationId?: number;
    subtotal: number;
    additionalCost: number;
    grandTotal: number;
    amountPaid: number;
    createdBy?: number;
    notes?: string;
  }): number {
    const locId = po.locationId || 1;
    const userId = po.createdBy || 1;

    // 1. Insert into legacy purchase_orders
    const info = this.db.prepare(`
      INSERT INTO purchase_orders (supplier_id, invoice_number, subtotal, additional_cost, grand_total, amount_paid, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?)
    `).run(
      po.supplierId,
      po.invoiceNumber,
      po.subtotal,
      po.additionalCost,
      po.grandTotal,
      po.amountPaid,
      po.notes || null
    );

    const poId = Number(info.lastInsertRowid);

    // 2. Insert into enterprise purchases table
    this.db.prepare(`
      INSERT OR REPLACE INTO purchases (
        id, purchase_number, supplier_id, supplier_invoice_number, location_id,
        status, subtotal_minor, additional_cost_minor, total_minor, created_by
      )
      VALUES (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?)
    `).run(
      poId,
      po.invoiceNumber,
      po.supplierId,
      po.invoiceNumber,
      locId,
      po.subtotal,
      po.additionalCost,
      po.grandTotal,
      userId
    );

    return poId;
  }

  public createItem(poId: number, item: PurchaseOrderItemInput): void {
    const unitId = item.unitId || 1;

    // Insert legacy
    this.db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, unit_name, quantity, conversion_factor, unit_cost_price, selling_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      poId,
      item.productId,
      item.unitName,
      item.quantity,
      item.conversionFactor,
      item.unitCostPrice,
      item.sellingPrice,
      item.lineTotal
    );

    // Insert enterprise purchase_lines
    this.db.prepare(`
      INSERT INTO purchase_lines (
        purchase_id, product_id, variant_id, unit_id, quantity_scaled, unit_cost_minor, discount_minor, tax_minor, line_total_minor
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      poId,
      item.productId,
      item.variantId || null,
      unitId,
      item.quantity,
      item.unitCostPrice,
      item.lineTotal
    );
  }

  public list(): PurchaseOrder[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.supplier_id as supplierId, s.name as supplierName, p.invoice_number as invoiceNumber,
             p.subtotal, p.additional_cost as additionalCost, p.grand_total as grandTotal,
             p.amount_paid as amountPaid, p.status, p.notes, p.created_at as createdAt
      FROM purchase_orders p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id DESC
      LIMIT 100
    `).all() as any[];

    return rows;
  }

  public createSupplierReturn(ret: {
    returnNumber: string;
    supplierId: number;
    originalPurchaseId?: number;
    locationId: number;
    reason: string;
    createdBy: number;
    lines: Array<{
      productId: number;
      variantId?: number;
      quantityScaled: number;
      costMinor: number;
    }>;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO supplier_returns (
        return_number, supplier_id, original_purchase_id, location_id, status, reason, created_by
      )
      VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(
      ret.returnNumber,
      ret.supplierId,
      ret.originalPurchaseId || null,
      ret.locationId,
      ret.reason,
      ret.createdBy
    );

    const retId = Number(info.lastInsertRowid);

    const insertLine = this.db.prepare(`
      INSERT INTO supplier_return_lines (supplier_return_id, product_id, variant_id, quantity_scaled, cost_minor)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const l of ret.lines) {
      insertLine.run(retId, l.productId, l.variantId || null, l.quantityScaled, l.costMinor);
    }

    return retId;
  }
}
