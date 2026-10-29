import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { Sale, SaleItem, SaleLine, SaleReturn } from '../../../shared/types';
import { SaleStatus } from '../../../shared/constants/accounts';
import { ISaleRepository } from '../../../shared/interfaces/repositories/ISaleRepository';

export class SaleRepository implements ISaleRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public getNextInvoiceNumber(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `INV-${today}-`;
    const lastRow = this.db.prepare(`
      SELECT invoice_number FROM sales
      WHERE invoice_number LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `).get(`${prefix}%`) as { invoice_number: string } | undefined;

    if (!lastRow) {
      return `${prefix}0001`;
    }

    const lastSequence = parseInt(lastRow.invoice_number.replace(prefix, ''), 10) || 0;
    const nextSeq = (lastSequence + 1).toString().padStart(4, '0');
    return `${prefix}${nextSeq}`;
  }

  public create(sale: {
    invoiceNumber: string;
    customerId?: number | string;
    cashierId: number;
    locationId?: number;
    registerId?: number;
    subtotal: number;
    totalDiscount: number;
    totalTax: number;
    grandTotal: number;
    totalCost: number;
    profit: number;
    paymentMethod: string;
    amountPaid: number;
    changeGiven: number;
    customerBalanceChange: number;
    notes?: string;
  }): number {
    const locId = sale.locationId || 1;
    const regId = sale.registerId || 1;

    const info = this.db.prepare(`
      INSERT INTO sales (
        invoice_number, customer_id, cashier_id, location_id, register_id,
        subtotal, total_discount, total_tax, grand_total, total_cost, profit,
        subtotal_minor, discount_minor, tax_minor, total_minor, total_cost_minor, profit_minor,
        payment_method, amount_paid, change_given, customer_balance_change,
        status, notes, created_by
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        'POSTED', ?, ?
      )
    `).run(
      sale.invoiceNumber,
      sale.customerId || null,
      sale.cashierId,
      locId,
      regId,
      sale.subtotal,
      sale.totalDiscount,
      sale.totalTax,
      sale.grandTotal,
      sale.totalCost,
      sale.profit,
      sale.subtotal,
      sale.totalDiscount,
      sale.totalTax,
      sale.grandTotal,
      sale.totalCost,
      sale.profit,
      sale.paymentMethod,
      sale.amountPaid,
      sale.changeGiven,
      sale.customerBalanceChange,
      sale.notes || null,
      sale.cashierId
    );

    return Number(info.lastInsertRowid);
  }

  /**
   * Historical Snapshot Preservation:
   * Saves product_name_snapshot, sku_snapshot, and minor pricing so future product catalog edits
   * never corrupt or alter previously posted bills.
   */
  public createItem(item: {
    saleId: number | string;
    productId: number | string;
    variantId?: number;
    productName: string;
    productSku?: string;
    productBarcode: string;
    unitId?: number;
    unitName: string;
    quantity: number;
    quantityScaled?: number;
    conversionFactor: number;
    conversionNumerator?: number;
    conversionDenominator?: number;
    unitPrice: number;
    costPrice: number;
    lineDiscount: number;
    allocatedBillDiscountMinor?: number;
    taxRate?: number;
    isTaxInclusive?: boolean;
    lineTax: number;
    lineTotal: number;
    lineProfit: number;
  }): void {
    const sku = item.productSku || item.productBarcode || `SKU-${item.productId}`;
    const unitId = item.unitId || 1;
    const qtyScaled = item.quantityScaled !== undefined
      ? item.quantityScaled
      : Math.round(item.quantity * 10000);
    const allocatedBillDiscount = item.allocatedBillDiscountMinor || 0;
    const taxRate = item.taxRate || 0;
    const isTaxInclusive = item.isTaxInclusive ? 1 : 0;
    const lineProfit = item.lineProfit !== undefined ? item.lineProfit : 0;
    const unitName = item.unitName || 'Piece';
    const num = item.conversionNumerator || 1;
    const den = item.conversionDenominator || 1;

    // Insert into legacy sale_items
    this.db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, product_name, product_barcode, unit_name,
        quantity, conversion_factor, unit_price, cost_price, line_discount,
        line_tax, line_total, line_profit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.saleId,
      item.productId,
      item.productName,
      item.productBarcode,
      item.unitName,
      item.quantity,
      item.conversionFactor,
      item.unitPrice,
      item.costPrice,
      item.lineDiscount,
      item.lineTax,
      item.lineTotal,
      item.lineProfit
    );

    // Insert into enterprise sale_lines with immutable snapshots
    this.db.prepare(`
      INSERT INTO sale_lines (
        sale_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
        unit_id, quantity_scaled, unit_price_minor, discount_minor, tax_minor,
        unit_cost_minor, line_total_minor, allocated_bill_discount_minor, tax_rate,
        is_tax_inclusive, line_profit_minor, unit_name_snapshot,
        conversion_numerator_snapshot, conversion_denominator_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.saleId,
      item.productId,
      item.variantId || null,
      item.productName,
      sku,
      unitId,
      qtyScaled,
      item.unitPrice,
      item.lineDiscount,
      item.lineTax,
      item.costPrice,
      item.lineTotal,
      allocatedBillDiscount,
      taxRate,
      isTaxInclusive,
      lineProfit,
      unitName,
      num,
      den
    );
  }

  public findById(id: number): Sale | null {
    const row = this.db.prepare(`
      SELECT s.id, s.invoice_number as invoiceNumber, s.customer_id as customerId, c.name as customerName,
             s.location_id as locationId, s.register_id as registerId,
             s.cashier_id as cashierId, u.full_name as cashierName,
             s.subtotal, s.total_discount as totalDiscount,
             s.total_tax as totalTax, s.grand_total as grandTotal, s.total_cost as totalCost,
             s.profit, s.payment_method as paymentMethod, s.amount_paid as amountPaid,
             s.change_given as changeGiven, s.customer_balance_change as customerBalanceChange,
             s.status, s.notes, s.created_at as createdAt
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE s.id = ?
    `).get(id) as any;

    if (!row) return null;

    const items = this.db.prepare(`
      SELECT id, sale_id as saleId, product_id as productId, product_name as productName,
             product_barcode as productBarcode, unit_name as unitName, quantity,
             conversion_factor as conversionFactor, unit_price as unitPrice, cost_price as costPrice,
             line_discount as lineDiscount, line_tax as lineTax, line_total as lineTotal,
             line_profit as lineProfit
      FROM sale_items
      WHERE sale_id = ?
    `).all(id) as SaleItem[];

    const lines = this.db.prepare(`
      SELECT id, sale_id as saleId, product_id as productId, variant_id as variantId,
             product_name_snapshot as productNameSnapshot, sku_snapshot as skuSnapshot,
             unit_id as unitId, unit_name_snapshot as unitNameSnapshot,
             quantity_scaled as quantityScaled,
             unit_price_minor as unitPriceMinor, discount_minor as discountMinor,
             allocated_bill_discount_minor as allocatedBillDiscountMinor,
             tax_minor as taxMinor, tax_rate as taxRate, is_tax_inclusive as isTaxInclusive,
             unit_cost_minor as unitCostMinor, line_total_minor as lineTotalMinor,
             line_profit_minor as lineProfitMinor,
             conversion_numerator_snapshot as conversionNumeratorSnapshot,
             conversion_denominator_snapshot as conversionDenominatorSnapshot
      FROM sale_lines
      WHERE sale_id = ?
    `).all(id) as SaleLine[];

    return {
      ...row,
      items,
      lines
    };
  }

  public list(limit = 100): Sale[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.invoice_number as invoiceNumber, s.customer_id as customerId, c.name as customerName,
             s.location_id as locationId, s.register_id as registerId,
             s.cashier_id as cashierId, u.full_name as cashierName,
             s.subtotal, s.total_discount as totalDiscount,
             s.total_tax as totalTax, s.grand_total as grandTotal, s.total_cost as totalCost,
             s.profit, s.payment_method as paymentMethod, s.amount_paid as amountPaid,
             s.change_given as changeGiven, s.customer_balance_change as customerBalanceChange,
             s.status, s.notes, s.created_at as createdAt
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN users u ON s.cashier_id = u.id
      ORDER BY s.id DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows;
  }

  public voidSale(id: number): void {
    this.db.prepare(`
      UPDATE sales SET status = 'VOIDED' WHERE id = ?
    `).run(id);
  }

  public createSaleReturn(ret: {
    returnNumber: string;
    originalSaleId: number;
    customerId?: number;
    locationId: number;
    reason: string;
    refundMinor: number;
    createdBy: number;
    lines: Array<{
      originalSaleLineId?: number;
      productId: number;
      variantId?: number;
      quantityScaled: number;
      disposition: 'RETURN_TO_STOCK' | 'DAMAGED_WRITE_OFF' | 'WARRANTY_REPAIR';
      refundMinor: number;
    }>;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO sale_returns (
        return_number, original_sale_id, customer_id, location_id, reason, status, refund_minor, created_by
      )
      VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(
      ret.returnNumber,
      ret.originalSaleId,
      ret.customerId || null,
      ret.locationId,
      ret.reason,
      ret.refundMinor,
      ret.createdBy
    );

    const returnId = Number(info.lastInsertRowid);

    const insertLine = this.db.prepare(`
      INSERT INTO sale_return_lines (
        sale_return_id, original_sale_line_id, product_id, variant_id, quantity_scaled, disposition, refund_minor
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const l of ret.lines) {
      insertLine.run(returnId, l.originalSaleLineId || null, l.productId, l.variantId || null, l.quantityScaled, l.disposition, l.refundMinor);
    }

    return returnId;
  }

  public getDailySummary(dateString: string): any {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(subtotal), 0) as grossSales,
        COALESCE(SUM(total_discount), 0) as totalDiscounts,
        COALESCE(SUM(total_tax), 0) as totalTax,
        COALESCE(SUM(grand_total), 0) as grandTotal,
        COALESCE(SUM(total_cost), 0) as totalCost,
        COALESCE(SUM(profit), 0) as totalProfit,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount_paid - change_given ELSE 0 END), 0) as cashCollected,
        COALESCE(SUM(CASE WHEN payment_method = 'CARD' THEN amount_paid ELSE 0 END), 0) as cardCollected,
        COALESCE(SUM(customer_balance_change), 0) as creditExtended
      FROM sales
      WHERE date(created_at) = date(?) AND status IN ('POSTED', 'COMPLETED')
    `).get(dateString);

    return row;
  }
}
