"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
class SerialRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. PRODUCT SERIAL SETTINGS
    // =========================================================================
    getSettings(productId, businessId) {
        const row = this.db.prepare(`
      SELECT * FROM product_serial_settings
      WHERE business_id = ? AND product_id = ?
    `).get(businessId, String(productId));
        if (!row)
            return null;
        let rule = null;
        if (row.serial_format_rule) {
            try {
                rule = typeof row.serial_format_rule === 'string'
                    ? JSON.parse(row.serial_format_rule)
                    : row.serial_format_rule;
            }
            catch {
                rule = null;
            }
        }
        return {
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            serialTrackingRequired: Boolean(row.serial_tracking_required),
            serialFormatRule: rule,
            warrantyDefaultMonths: row.warranty_default_months != null ? Number(row.warranty_default_months) : null,
            allowManualSerialEntry: Boolean(row.allow_manual_serial_entry),
            warrantyStartTrigger: row.warranty_start_trigger || 'on_sale',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    upsertSettings(input) {
        const prodId = String(input.productId);
        const existing = this.getSettings(prodId, input.businessId);
        const ruleJson = input.serialFormatRule ? JSON.stringify(input.serialFormatRule) : null;
        const now = new Date().toISOString();
        if (existing) {
            this.db.prepare(`
        UPDATE product_serial_settings
        SET serial_tracking_required = ?,
            serial_format_rule = ?,
            warranty_default_months = ?,
            allow_manual_serial_entry = ?,
            warranty_start_trigger = ?,
            updated_at = ?
        WHERE id = ?
      `).run(input.serialTrackingRequired ? 1 : 0, ruleJson, input.warrantyDefaultMonths !== undefined ? input.warrantyDefaultMonths : existing.warrantyDefaultMonths, input.allowManualSerialEntry !== undefined ? (input.allowManualSerialEntry ? 1 : 0) : (existing.allowManualSerialEntry ? 1 : 0), input.warrantyStartTrigger || existing.warrantyStartTrigger, now, existing.id);
            return this.getSettings(prodId, input.businessId);
        }
        const id = (0, crypto_1.randomUUID)();
        this.db.prepare(`
      INSERT INTO product_serial_settings (
        id, business_id, product_id, serial_tracking_required,
        serial_format_rule, warranty_default_months,
        allow_manual_serial_entry, warranty_start_trigger,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.businessId, prodId, input.serialTrackingRequired ? 1 : 0, ruleJson, input.warrantyDefaultMonths ?? null, input.allowManualSerialEntry !== undefined ? (input.allowManualSerialEntry ? 1 : 0) : 1, input.warrantyStartTrigger || 'on_sale', now, now);
        return this.getSettings(prodId, input.businessId);
    }
    // =========================================================================
    // 2. PRODUCT SERIAL NUMBERS
    // =========================================================================
    mapRowToSerial(row) {
        return {
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            serialNumber: row.serial_number,
            manufacturerSerial: row.manufacturer_serial,
            imei1: row.imei_1,
            imei2: row.imei_2,
            purchaseDocumentLineId: row.purchase_document_line_id,
            supplierId: row.supplier_id,
            currentLocationId: row.current_location_id,
            status: row.status,
            unitCostMinor: row.unit_cost_minor != null ? Number(row.unit_cost_minor) : null,
            receivedAt: row.received_at,
            soldAt: row.sold_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    findById(id) {
        const row = this.db.prepare('SELECT * FROM product_serial_numbers WHERE id = ?').get(id);
        return row ? this.mapRowToSerial(row) : null;
    }
    findBySerialNumber(businessId, productId, serialNumber) {
        const row = this.db.prepare(`
      SELECT * FROM product_serial_numbers
      WHERE business_id = ? AND product_id = ? AND UPPER(serial_number) = UPPER(?)
    `).get(businessId, String(productId), serialNumber.trim());
        return row ? this.mapRowToSerial(row) : null;
    }
    findBySerialNumberAnyProduct(businessId, serialNumber) {
        const row = this.db.prepare(`
      SELECT * FROM product_serial_numbers
      WHERE business_id = ? AND UPPER(serial_number) = UPPER(?)
    `).get(businessId, serialNumber.trim());
        return row ? this.mapRowToSerial(row) : null;
    }
    findByImei(businessId, imei) {
        const clean = imei.trim();
        const row = this.db.prepare(`
      SELECT * FROM product_serial_numbers
      WHERE business_id = ? AND (imei_1 = ? OR imei_2 = ?)
    `).get(businessId, clean, clean);
        return row ? this.mapRowToSerial(row) : null;
    }
    findAvailableAtLocation(businessId, productId, locationId) {
        const rows = this.db.prepare(`
      SELECT * FROM product_serial_numbers
      WHERE business_id = ? AND product_id = ? AND current_location_id = ? AND status = 'in_stock'
      ORDER BY created_at ASC, id ASC
    `).all(businessId, String(productId), locationId);
        return rows.map((r) => this.mapRowToSerial(r));
    }
    create(data) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO product_serial_numbers (
        id, business_id, product_id, serial_number, manufacturer_serial,
        imei_1, imei_2, purchase_document_line_id, supplier_id,
        current_location_id, status, unit_cost_minor, received_at, sold_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.businessId, String(data.productId), data.serialNumber.trim(), data.manufacturerSerial?.trim() || null, data.imei1?.trim() || null, data.imei2?.trim() || null, data.purchaseDocumentLineId || null, data.supplierId || null, data.currentLocationId || null, data.status || 'in_stock', data.unitCostMinor ?? null, data.receivedAt || now, data.soldAt || null, now, now);
        return this.findById(id);
    }
    createBatch(items) {
        const results = [];
        const insertStmt = this.db.prepare(`
      INSERT INTO product_serial_numbers (
        id, business_id, product_id, serial_number, manufacturer_serial,
        imei_1, imei_2, purchase_document_line_id, supplier_id,
        current_location_id, status, unit_cost_minor, received_at, sold_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const now = new Date().toISOString();
        for (const data of items) {
            const id = (0, crypto_1.randomUUID)();
            insertStmt.run(id, data.businessId, String(data.productId), data.serialNumber.trim(), data.manufacturerSerial?.trim() || null, data.imei1?.trim() || null, data.imei2?.trim() || null, data.purchaseDocumentLineId || null, data.supplierId || null, data.currentLocationId || null, data.status || 'in_stock', data.unitCostMinor ?? null, data.receivedAt || now, data.soldAt || null, now, now);
            results.push(this.findById(id));
        }
        return results;
    }
    updateStatus(id, status, soldAt) {
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE product_serial_numbers
      SET status = ?,
          sold_at = COALESCE(?, sold_at),
          updated_at = ?
      WHERE id = ?
    `).run(status, soldAt || null, now, id);
    }
    /**
     * Concurrency Guard: Atomically sells a serial only if currently 'in_stock'.
     * Returns true if successfully claimed and marked as sold; false if already sold/taken.
     */
    atomicSellSerial(id, soldAt) {
        const now = new Date().toISOString();
        const result = this.db.prepare(`
      UPDATE product_serial_numbers
      SET status = 'sold',
          sold_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'in_stock'
    `).run(soldAt, now, id);
        return result.changes === 1;
    }
    updateLocation(id, newLocationId) {
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE product_serial_numbers
      SET current_location_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newLocationId, now, id);
    }
    // =========================================================================
    // 3. SERIAL NUMBER HISTORY
    // =========================================================================
    logHistory(entry) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO serial_number_history (
        id, business_id, serial_number_id, event_type, reference_type,
        reference_id, from_location_id, to_location_id, from_status,
        to_status, notes, performed_by, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.businessId, entry.serialNumberId, entry.eventType, entry.referenceType || null, entry.referenceId ? String(entry.referenceId) : null, entry.fromLocationId || null, entry.toLocationId || null, entry.fromStatus || null, entry.toStatus || null, entry.notes || null, entry.performedBy ? String(entry.performedBy) : null, now);
        return {
            id,
            businessId: entry.businessId,
            serialNumberId: entry.serialNumberId,
            eventType: entry.eventType,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId ? String(entry.referenceId) : undefined,
            fromLocationId: entry.fromLocationId,
            toLocationId: entry.toLocationId,
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            notes: entry.notes,
            performedBy: entry.performedBy,
            occurredAt: now
        };
    }
    getHistory(serialNumberId) {
        const rows = this.db.prepare(`
      SELECT * FROM serial_number_history
      WHERE serial_number_id = ?
      ORDER BY occurred_at ASC
    `).all(serialNumberId);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            serialNumberId: r.serial_number_id,
            eventType: r.event_type,
            referenceType: r.reference_type,
            referenceId: r.reference_id,
            fromLocationId: r.from_location_id,
            toLocationId: r.to_location_id,
            fromStatus: r.from_status,
            toStatus: r.to_status,
            notes: r.notes,
            performedBy: r.performed_by,
            occurredAt: r.occurred_at
        }));
    }
    // =========================================================================
    // 4. SERIAL WARRANTIES
    // =========================================================================
    createWarranty(entry) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO serial_warranties (
        id, business_id, serial_number_id, warranty_start_date,
        warranty_end_date, warranty_provider, warranty_reference,
        warranty_terms, warranty_trigger, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.businessId, entry.serialNumberId, entry.warrantyStartDate, entry.warrantyEndDate || null, entry.warrantyProvider || null, entry.warrantyReference || null, entry.warrantyTerms || null, entry.warrantyTrigger || 'on_sale', now, now);
        return {
            id,
            businessId: entry.businessId,
            serialNumberId: entry.serialNumberId,
            warrantyStartDate: entry.warrantyStartDate,
            warrantyEndDate: entry.warrantyEndDate || null,
            warrantyProvider: entry.warrantyProvider,
            warrantyReference: entry.warrantyReference,
            warrantyTerms: entry.warrantyTerms,
            warrantyTrigger: entry.warrantyTrigger,
            createdAt: now,
            updatedAt: now
        };
    }
    getWarrantyForSerial(serialNumberId) {
        const row = this.db.prepare(`
      SELECT * FROM serial_warranties
      WHERE serial_number_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(serialNumberId);
        if (!row)
            return null;
        return {
            id: row.id,
            businessId: row.business_id,
            serialNumberId: row.serial_number_id,
            warrantyStartDate: row.warranty_start_date,
            warrantyEndDate: row.warranty_end_date,
            warrantyProvider: row.warranty_provider,
            warrantyReference: row.warranty_reference,
            warrantyTerms: row.warranty_terms,
            warrantyTrigger: row.warranty_trigger,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    // =========================================================================
    // 5. SALE ITEM SERIALS
    // =========================================================================
    createSaleItemSerial(entry) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO sale_item_serials (
        id, business_id, sale_id, sale_item_id, product_id,
        serial_number_id, unit_cost_minor, warranty_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.businessId, String(entry.saleId), String(entry.saleItemId), String(entry.productId), entry.serialNumberId, entry.unitCostMinor ?? null, entry.warrantyId || null, now);
        return {
            id,
            businessId: entry.businessId,
            saleId: entry.saleId,
            saleItemId: entry.saleItemId,
            productId: entry.productId,
            serialNumberId: entry.serialNumberId,
            unitCostMinor: entry.unitCostMinor,
            warrantyId: entry.warrantyId,
            createdAt: now
        };
    }
    getSaleItemSerials(saleId) {
        const rows = this.db.prepare(`
      SELECT * FROM sale_item_serials WHERE sale_id = ?
    `).all(String(saleId));
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            saleId: r.sale_id,
            saleItemId: r.sale_item_id,
            productId: r.product_id,
            serialNumberId: r.serial_number_id,
            unitCostMinor: r.unit_cost_minor != null ? Number(r.unit_cost_minor) : null,
            warrantyId: r.warranty_id,
            createdAt: r.created_at
        }));
    }
    getSaleForSerial(serialNumberId) {
        const row = this.db.prepare(`
      SELECT sis.*, s.invoice_number, s.created_at as sale_date, s.customer_id,
             c.name as customer_name, c.phone as customer_phone
      FROM sale_item_serials sis
      JOIN sales s ON s.id = sis.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE sis.serial_number_id = ?
      ORDER BY sis.created_at DESC
      LIMIT 1
    `).get(serialNumberId);
        return row || null;
    }
    // =========================================================================
    // 6. SEARCH & QUERY
    // =========================================================================
    searchSerials(query) {
        let sql = `
      SELECT psn.*
      FROM product_serial_numbers psn
      JOIN products p ON p.id = psn.product_id
      LEFT JOIN sale_item_serials sis ON sis.serial_number_id = psn.id
      LEFT JOIN sales s ON s.id = sis.sale_id
      WHERE psn.business_id = ?
    `;
        const params = [query.businessId];
        if (query.productId) {
            sql += ' AND psn.product_id = ?';
            params.push(String(query.productId));
        }
        if (query.status) {
            sql += ' AND psn.status = ?';
            params.push(query.status);
        }
        if (query.currentLocationId) {
            sql += ' AND psn.current_location_id = ?';
            params.push(query.currentLocationId);
        }
        if (query.query && query.query.trim()) {
            const q = `%${query.query.trim()}%`;
            sql += `
        AND (
          psn.serial_number LIKE ?
          OR psn.imei_1 LIKE ?
          OR psn.imei_2 LIKE ?
          OR psn.manufacturer_serial LIKE ?
          OR p.name LIKE ?
          OR s.invoice_number LIKE ?
          OR psn.purchase_document_line_id LIKE ?
        )
      `;
            params.push(q, q, q, q, q, q, q);
        }
        // Distinct in case of multiple sale links
        const countSql = `SELECT COUNT(DISTINCT psn.id) as total FROM (${sql}) psn`;
        const countRow = this.db.prepare(countSql).get(...params);
        const total = countRow?.total || 0;
        sql += ' GROUP BY psn.id ORDER BY psn.created_at DESC';
        const page = Math.max(1, query.page || 1);
        const pageSize = Math.max(1, query.pageSize || 50);
        const offset = (page - 1) * pageSize;
        sql += ` LIMIT ${pageSize} OFFSET ${offset}`;
        const rows = this.db.prepare(sql).all(...params);
        return {
            items: rows.map((r) => this.mapRowToSerial(r)),
            total
        };
    }
}
exports.SerialRepository = SerialRepository;
