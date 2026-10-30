"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseInvoiceRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
class PurchaseInvoiceRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. SETTINGS
    // =========================================================================
    getSettings(businessId) {
        const row = this.db.prepare(`
      SELECT * FROM purchase_invoice_settings WHERE business_id = ?
    `).get(businessId);
        if (!row)
            return null;
        return {
            id: row.id,
            businessId: row.business_id,
            duplicateInvoicePolicy: row.duplicate_invoice_policy,
            priceVarianceThresholdMinor: Number(row.price_variance_threshold_minor),
            priceVarianceThresholdPercent: Number(row.price_variance_threshold_percent),
            allowInvoiceBeforeGrn: Boolean(row.allow_invoice_before_grn),
            allowOverInvoicing: Boolean(row.allow_over_invoicing),
            closedPeriodBeforeDate: row.closed_period_before_date || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    upsertSettings(settings) {
        const existing = this.getSettings(settings.businessId);
        const now = new Date().toISOString();
        if (existing) {
            this.db.prepare(`
        UPDATE purchase_invoice_settings
        SET duplicate_invoice_policy = COALESCE(?, duplicate_invoice_policy),
            price_variance_threshold_minor = COALESCE(?, price_variance_threshold_minor),
            price_variance_threshold_percent = COALESCE(?, price_variance_threshold_percent),
            allow_invoice_before_grn = COALESCE(?, allow_invoice_before_grn),
            allow_over_invoicing = COALESCE(?, allow_over_invoicing),
            closed_period_before_date = COALESCE(?, closed_period_before_date),
            updated_at = ?
        WHERE business_id = ?
      `).run(settings.duplicateInvoicePolicy, settings.priceVarianceThresholdMinor, settings.priceVarianceThresholdPercent, settings.allowInvoiceBeforeGrn !== undefined ? (settings.allowInvoiceBeforeGrn ? 1 : 0) : null, settings.allowOverInvoicing !== undefined ? (settings.allowOverInvoicing ? 1 : 0) : null, settings.closedPeriodBeforeDate, now, settings.businessId);
        }
        else {
            this.db.prepare(`
        INSERT INTO purchase_invoice_settings (
          id, business_id, duplicate_invoice_policy, price_variance_threshold_minor,
          price_variance_threshold_percent, allow_invoice_before_grn, allow_over_invoicing,
          closed_period_before_date, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?
        )
      `).run((0, crypto_1.randomUUID)(), settings.businessId, settings.duplicateInvoicePolicy || 'block', settings.priceVarianceThresholdMinor ?? 1000, settings.priceVarianceThresholdPercent ?? 5.0, settings.allowInvoiceBeforeGrn ? 1 : 0, settings.allowOverInvoicing ? 1 : 0, settings.closedPeriodBeforeDate || null, now, now);
        }
        return this.getSettings(settings.businessId);
    }
    // =========================================================================
    // 2. ACCOUNTING PERIODS
    // =========================================================================
    getAccountingPeriods(businessId) {
        const rows = this.db.prepare(`
      SELECT * FROM accounting_periods WHERE business_id = ? ORDER BY start_date DESC
    `).all(businessId);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            periodName: r.period_name,
            startDate: r.start_date,
            endDate: r.end_date,
            isClosed: Boolean(r.is_closed),
            closedAt: r.closed_at,
            closedBy: r.closed_by,
            createdAt: r.created_at
        }));
    }
    createAccountingPeriod(period) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO accounting_periods (
        id, business_id, period_name, start_date, end_date, is_closed, closed_at, closed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, period.businessId, period.periodName, period.startDate, period.endDate, period.isClosed ? 1 : 0, period.closedAt || null, period.closedBy || null, now);
        const created = this.db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(id);
        return {
            id: created.id,
            businessId: created.business_id,
            periodName: created.period_name,
            startDate: created.start_date,
            endDate: created.end_date,
            isClosed: Boolean(created.is_closed),
            closedAt: created.closed_at,
            closedBy: created.closed_by,
            createdAt: created.created_at
        };
    }
    closeAccountingPeriod(periodId, closedBy) {
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE accounting_periods
      SET is_closed = 1, closed_at = ?, closed_by = ?
      WHERE id = ?
    `).run(now, closedBy || null, periodId);
    }
    isDateInClosedPeriod(businessId, date) {
        const settings = this.getSettings(businessId);
        if (settings?.closedPeriodBeforeDate && date < settings.closedPeriodBeforeDate) {
            return { isClosed: true, periodName: `Prior to ${settings.closedPeriodBeforeDate}` };
        }
        const row = this.db.prepare(`
      SELECT period_name FROM accounting_periods
      WHERE business_id = ? AND is_closed = 1 AND ? >= start_date AND ? <= end_date
      LIMIT 1
    `).get(businessId, date, date);
        if (row) {
            return { isClosed: true, periodName: row.period_name };
        }
        return { isClosed: false };
    }
    // =========================================================================
    // 3. READ QUERIES
    // =========================================================================
    findById(id, businessId) {
        let sql = `
      SELECT pi.*,
             b.name as branch_name,
             s.name as supplier_name,
             s.supplier_code,
             u_cre.full_name as created_by_name,
             u_pos.full_name as posted_by_name
      FROM purchase_invoices pi
      LEFT JOIN branches b ON pi.branch_id = b.id
      JOIN suppliers s ON pi.supplier_id = s.id
      LEFT JOIN users u_cre ON pi.created_by = CAST(u_cre.id AS TEXT)
      LEFT JOIN users u_pos ON pi.posted_by = CAST(u_pos.id AS TEXT)
      WHERE pi.id = ?
    `;
        const params = [id];
        if (businessId) {
            sql += ' AND pi.business_id = ?';
            params.push(businessId);
        }
        const row = this.db.prepare(sql).get(...params);
        if (!row)
            return null;
        const invoice = this.mapInvoiceRow(row);
        invoice.lines = this.getLines(invoice.id);
        return invoice;
    }
    findByInvoiceNumber(businessId, invoiceNumber) {
        const row = this.db.prepare(`
      SELECT id FROM purchase_invoices WHERE business_id = ? AND invoice_number = ?
    `).get(businessId, invoiceNumber);
        return row ? this.findById(row.id, businessId) : null;
    }
    findBySupplierInvoiceNumber(businessId, supplierId, supplierInvoiceNumber) {
        const row = this.db.prepare(`
      SELECT id FROM purchase_invoices
      WHERE business_id = ? AND supplier_id = ? AND supplier_invoice_number = ? AND status != 'voided'
      LIMIT 1
    `).get(businessId, supplierId, supplierInvoiceNumber);
        return row ? this.findById(row.id, businessId) : null;
    }
    findByIdempotencyKey(businessId, idempotencyKey) {
        const row = this.db.prepare(`
      SELECT id FROM purchase_invoices WHERE business_id = ? AND idempotency_key = ?
    `).get(businessId, idempotencyKey);
        return row ? this.findById(row.id, businessId) : null;
    }
    list(filter) {
        let whereClause = 'WHERE pi.business_id = ?';
        const params = [filter.businessId];
        if (filter.branchId) {
            whereClause += ' AND pi.branch_id = ?';
            params.push(filter.branchId);
        }
        if (filter.supplierId) {
            whereClause += ' AND pi.supplier_id = ?';
            params.push(filter.supplierId);
        }
        if (filter.status) {
            if (Array.isArray(filter.status)) {
                whereClause += ` AND pi.status IN (${filter.status.map(() => '?').join(',')})`;
                params.push(...filter.status);
            }
            else {
                whereClause += ' AND pi.status = ?';
                params.push(filter.status);
            }
        }
        if (filter.startDate) {
            whereClause += ' AND pi.invoice_date >= ?';
            params.push(filter.startDate);
        }
        if (filter.endDate) {
            whereClause += ' AND pi.invoice_date <= ?';
            params.push(filter.endDate);
        }
        if (filter.searchTerm) {
            whereClause += ' AND (pi.invoice_number LIKE ? OR pi.supplier_invoice_number LIKE ? OR s.name LIKE ?)';
            const term = `%${filter.searchTerm}%`;
            params.push(term, term, term);
        }
        const countRow = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM purchase_invoices pi
      JOIN suppliers s ON pi.supplier_id = s.id
      ${whereClause}
    `).get(...params);
        let query = `
      SELECT pi.*,
             b.name as branch_name,
             s.name as supplier_name,
             s.supplier_code,
             u_cre.full_name as created_by_name,
             u_pos.full_name as posted_by_name
      FROM purchase_invoices pi
      LEFT JOIN branches b ON pi.branch_id = b.id
      JOIN suppliers s ON pi.supplier_id = s.id
      LEFT JOIN users u_cre ON pi.created_by = CAST(u_cre.id AS TEXT)
      LEFT JOIN users u_pos ON pi.posted_by = CAST(u_pos.id AS TEXT)
      ${whereClause}
      ORDER BY pi.invoice_date DESC, pi.rowid DESC
    `;
        if (filter.limit) {
            query += ` LIMIT ${Number(filter.limit)}`;
            if (filter.offset) {
                query += ` OFFSET ${Number(filter.offset)}`;
            }
        }
        const rows = this.db.prepare(query).all(...params);
        return {
            invoices: rows.map((r) => this.mapInvoiceRow(r)),
            total: countRow.count
        };
    }
    // =========================================================================
    // 4. MUTATIONS
    // =========================================================================
    create(invoice, lines) {
        const invoiceId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            // 1. Insert header
            this.db.prepare(`
        INSERT INTO purchase_invoices (
          id, business_id, branch_id, supplier_id, invoice_number,
          supplier_invoice_number, invoice_date, due_date, currency_code,
          exchange_rate_numerator, exchange_rate_denominator, subtotal_minor,
          discount_minor, tax_minor, shipping_minor, other_charges_minor,
          total_minor, paid_minor, outstanding_minor, status, notes,
          created_by, posted_by, posted_at, idempotency_key, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `).run(invoiceId, invoice.businessId, invoice.branchId, invoice.supplierId, invoice.invoiceNumber, invoice.supplierInvoiceNumber || null, invoice.invoiceDate, invoice.dueDate || null, invoice.currencyCode || 'PKR', invoice.exchangeRateNumerator || 1, invoice.exchangeRateDenominator || 1, invoice.subtotalMinor, invoice.discountMinor || 0, invoice.taxMinor || 0, invoice.shippingMinor || 0, invoice.otherChargesMinor || 0, invoice.totalMinor, invoice.paidMinor || 0, invoice.outstandingMinor, invoice.status || 'draft', invoice.notes || null, String(invoice.createdBy || '1'), invoice.postedBy ? String(invoice.postedBy) : null, invoice.postedAt || null, invoice.idempotencyKey, now, now);
            // 2. Insert lines & allocations
            const lineInsert = this.db.prepare(`
        INSERT INTO purchase_invoice_lines (
          id, purchase_invoice_id, goods_receipt_line_id, purchase_order_line_id,
          product_id, variant_id, batch_id, description_snapshot,
          quantity_scaled, unit_id, conversion_numerator, conversion_denominator,
          unit_price_minor, discount_minor, tax_profile_id, tax_minor, line_total_minor
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `);
            const allocInsert = this.db.prepare(`
        INSERT INTO purchase_invoice_receipt_allocations (
          id, purchase_invoice_line_id, goods_receipt_line_id, allocated_quantity_scaled, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
            for (const line of lines) {
                const lineId = (0, crypto_1.randomUUID)();
                lineInsert.run(lineId, invoiceId, line.goodsReceiptLineId || null, line.purchaseOrderLineId || null, String(line.productId), line.variantId ? String(line.variantId) : null, line.batchId ? String(line.batchId) : null, line.descriptionSnapshot || null, line.quantityScaled, String(line.unitId), line.conversionNumerator || 1, line.conversionDenominator || 1, line.unitPriceMinor, line.discountMinor || 0, line.taxProfileId || null, line.taxMinor || 0, line.lineTotalMinor);
                if (line.allocations && line.allocations.length > 0) {
                    for (const a of line.allocations) {
                        allocInsert.run((0, crypto_1.randomUUID)(), lineId, a.goodsReceiptLineId, a.allocatedQuantityScaled, now);
                    }
                }
                else if (line.goodsReceiptLineId) {
                    // Default 1-1 allocation if goodsReceiptLineId provided without explicit allocations
                    allocInsert.run((0, crypto_1.randomUUID)(), lineId, line.goodsReceiptLineId, line.quantityScaled, now);
                }
            }
        });
        tx();
        return this.findById(invoiceId, invoice.businessId);
    }
    update(invoiceId, updates, lines) {
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        UPDATE purchase_invoices
        SET supplier_invoice_number = COALESCE(?, supplier_invoice_number),
            invoice_date = COALESCE(?, invoice_date),
            due_date = COALESCE(?, due_date),
            subtotal_minor = COALESCE(?, subtotal_minor),
            discount_minor = COALESCE(?, discount_minor),
            tax_minor = COALESCE(?, tax_minor),
            shipping_minor = COALESCE(?, shipping_minor),
            other_charges_minor = COALESCE(?, other_charges_minor),
            total_minor = COALESCE(?, total_minor),
            outstanding_minor = COALESCE(?, outstanding_minor),
            notes = COALESCE(?, notes),
            status = COALESCE(?, status),
            updated_at = ?
        WHERE id = ?
      `).run(updates.supplierInvoiceNumber, updates.invoiceDate, updates.dueDate, updates.subtotalMinor, updates.discountMinor, updates.taxMinor, updates.shippingMinor, updates.otherChargesMinor, updates.totalMinor, updates.outstandingMinor, updates.notes, updates.status, now, invoiceId);
            if (lines) {
                // Remove existing lines and re-insert
                this.db.prepare('DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').run(invoiceId);
                const lineInsert = this.db.prepare(`
          INSERT INTO purchase_invoice_lines (
            id, purchase_invoice_id, goods_receipt_line_id, purchase_order_line_id,
            product_id, variant_id, batch_id, description_snapshot,
            quantity_scaled, unit_id, conversion_numerator, conversion_denominator,
            unit_price_minor, discount_minor, tax_profile_id, tax_minor, line_total_minor
          ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?
          )
        `);
                const allocInsert = this.db.prepare(`
          INSERT INTO purchase_invoice_receipt_allocations (
            id, purchase_invoice_line_id, goods_receipt_line_id, allocated_quantity_scaled, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `);
                for (const line of lines) {
                    const lineId = (0, crypto_1.randomUUID)();
                    lineInsert.run(lineId, invoiceId, line.goodsReceiptLineId || null, line.purchaseOrderLineId || null, String(line.productId), line.variantId ? String(line.variantId) : null, line.batchId ? String(line.batchId) : null, line.descriptionSnapshot || null, line.quantityScaled, String(line.unitId), line.conversionNumerator || 1, line.conversionDenominator || 1, line.unitPriceMinor, line.discountMinor || 0, line.taxProfileId || null, line.taxMinor || 0, line.lineTotalMinor);
                    if (line.allocations && line.allocations.length > 0) {
                        for (const a of line.allocations) {
                            allocInsert.run((0, crypto_1.randomUUID)(), lineId, a.goodsReceiptLineId, a.allocatedQuantityScaled, now);
                        }
                    }
                    else if (line.goodsReceiptLineId) {
                        allocInsert.run((0, crypto_1.randomUUID)(), lineId, line.goodsReceiptLineId, line.quantityScaled, now);
                    }
                }
            }
        });
        tx();
        return this.findById(invoiceId);
    }
    updateStatus(id, status, metadata) {
        const now = new Date().toISOString();
        let sql = 'UPDATE purchase_invoices SET status = ?, updated_at = ?';
        const params = [status, now];
        if (metadata?.postedBy) {
            sql += ', posted_by = ?, posted_at = ?';
            params.push(metadata.postedBy, metadata.postedAt || now);
        }
        sql += ' WHERE id = ?';
        params.push(id);
        this.db.prepare(sql).run(...params);
    }
    updatePayment(id, paidDeltaMinor) {
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE purchase_invoices
      SET paid_minor = paid_minor + ?,
          outstanding_minor = MAX(0, total_minor - (paid_minor + ?)),
          status = CASE
            WHEN (paid_minor + ?) >= total_minor THEN 'paid'
            WHEN (paid_minor + ?) > 0 THEN 'partially_paid'
            ELSE status
          END,
          updated_at = ?
      WHERE id = ?
    `).run(paidDeltaMinor, paidDeltaMinor, paidDeltaMinor, paidDeltaMinor, now, id);
    }
    getLines(purchaseInvoiceId) {
        const rows = this.db.prepare(`
      SELECT l.*,
             p.name as product_name,
             p.sku as product_sku,
             u.name as unit_name
      FROM purchase_invoice_lines l
      JOIN products p ON l.product_id = p.id
      JOIN units u ON l.unit_id = u.id
      WHERE l.purchase_invoice_id = ?
      ORDER BY l.rowid ASC
    `).all(purchaseInvoiceId);
        return rows.map((r) => ({
            id: r.id,
            purchaseInvoiceId: r.purchase_invoice_id,
            goodsReceiptLineId: r.goods_receipt_line_id,
            purchaseOrderLineId: r.purchase_order_line_id,
            productId: r.product_id,
            productName: r.product_name,
            productSku: r.product_sku,
            variantId: r.variant_id,
            batchId: r.batch_id,
            descriptionSnapshot: r.description_snapshot,
            quantityScaled: Number(r.quantity_scaled),
            unitId: r.unit_id,
            unitName: r.unit_name,
            conversionNumerator: Number(r.conversion_numerator),
            conversionDenominator: Number(r.conversion_denominator),
            unitPriceMinor: Number(r.unit_price_minor),
            discountMinor: Number(r.discount_minor),
            taxProfileId: r.tax_profile_id,
            taxMinor: Number(r.tax_minor),
            lineTotalMinor: Number(r.line_total_minor),
            allocations: this.getAllocations(r.id)
        }));
    }
    getAllocations(purchaseInvoiceLineId) {
        const rows = this.db.prepare(`
      SELECT * FROM purchase_invoice_receipt_allocations WHERE purchase_invoice_line_id = ?
    `).all(purchaseInvoiceLineId);
        return rows.map((r) => ({
            id: r.id,
            purchaseInvoiceLineId: r.purchase_invoice_line_id,
            goodsReceiptLineId: r.goods_receipt_line_id,
            allocatedQuantityScaled: Number(r.allocated_quantity_scaled),
            createdAt: r.created_at
        }));
    }
    /**
     * Returns total quantity scaled already invoiced against a given Goods Receipt line
     * across all non-voided purchase invoices.
     */
    getTotalInvoicedQuantityForGrnLine(goodsReceiptLineId, excludeInvoiceId) {
        let sql = `
      SELECT COALESCE(SUM(a.allocated_quantity_scaled), 0) as total_invoiced
      FROM purchase_invoice_receipt_allocations a
      JOIN purchase_invoice_lines l ON a.purchase_invoice_line_id = l.id
      JOIN purchase_invoices pi ON l.purchase_invoice_id = pi.id
      WHERE a.goods_receipt_line_id = ? AND pi.status != 'voided'
    `;
        const params = [goodsReceiptLineId];
        if (excludeInvoiceId) {
            sql += ' AND pi.id != ?';
            params.push(excludeInvoiceId);
        }
        const row = this.db.prepare(sql).get(...params);
        return row?.total_invoiced || 0;
    }
    // =========================================================================
    // 5. HELPER MAPPING
    // =========================================================================
    mapInvoiceRow(r) {
        return {
            id: r.id,
            businessId: r.business_id,
            branchId: r.branch_id,
            branchName: r.branch_name,
            supplierId: r.supplier_id,
            supplierName: r.supplier_name,
            supplierCode: r.supplier_code,
            invoiceNumber: r.invoice_number,
            supplierInvoiceNumber: r.supplier_invoice_number,
            invoiceDate: r.invoice_date,
            dueDate: r.due_date,
            currencyCode: r.currency_code,
            exchangeRateNumerator: Number(r.exchange_rate_numerator || 1),
            exchangeRateDenominator: Number(r.exchange_rate_denominator || 1),
            subtotalMinor: Number(r.subtotal_minor || 0),
            discountMinor: Number(r.discount_minor || 0),
            taxMinor: Number(r.tax_minor || 0),
            shippingMinor: Number(r.shipping_minor || 0),
            otherChargesMinor: Number(r.other_charges_minor || 0),
            totalMinor: Number(r.total_minor || 0),
            paidMinor: Number(r.paid_minor || 0),
            outstandingMinor: Number(r.outstanding_minor || 0),
            status: r.status,
            notes: r.notes,
            createdBy: r.created_by,
            createdByName: r.created_by_name,
            postedBy: r.posted_by,
            postedByName: r.posted_by_name,
            postedAt: r.posted_at,
            idempotencyKey: r.idempotency_key,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    }
}
exports.PurchaseInvoiceRepository = PurchaseInvoiceRepository;
