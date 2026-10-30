"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
const batch_expiry_math_1 = require("../../../domain/inventory/batch-expiry-math");
class BatchRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. PRODUCT BATCH SETTINGS
    // =========================================================================
    upsertSettings(dto) {
        const prodId = String(dto.productId);
        const now = new Date().toISOString();
        const existing = this.getSettings(prodId, dto.businessId);
        if (existing) {
            this.db.prepare(`
        UPDATE product_batch_settings
        SET requires_batch = ?,
            requires_expiry = ?,
            expiry_warning_days = ?,
            expiry_sale_policy = ?,
            batch_cost_policy = ?,
            updated_at = ?
        WHERE id = ?
      `).run(dto.requiresBatch ? 1 : 0, dto.requiresExpiry ? 1 : 0, dto.expiryWarningDays !== undefined ? dto.expiryWarningDays : existing.expiryWarningDays, dto.expirySalePolicy || existing.expirySalePolicy, dto.batchCostPolicy || existing.batchCostPolicy, now, existing.id);
            return this.getSettings(prodId, dto.businessId);
        }
        const id = (0, crypto_1.randomUUID)();
        this.db.prepare(`
      INSERT INTO product_batch_settings (
        id, business_id, product_id, requires_batch, requires_expiry,
        expiry_warning_days, expiry_sale_policy, batch_cost_policy,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, dto.businessId, prodId, dto.requiresBatch ? 1 : 0, dto.requiresExpiry ? 1 : 0, dto.expiryWarningDays !== undefined ? dto.expiryWarningDays : 30, dto.expirySalePolicy || 'block', dto.batchCostPolicy || 'batch_specific', now, now);
        return this.getSettings(prodId, dto.businessId);
    }
    getSettings(productId, businessId) {
        const row = this.db.prepare(`
      SELECT * FROM product_batch_settings
      WHERE business_id = ? AND product_id = ?
    `).get(businessId, String(productId));
        if (!row)
            return null;
        return {
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            requiresBatch: Boolean(row.requires_batch),
            requiresExpiry: Boolean(row.requires_expiry),
            expiryWarningDays: Number(row.expiry_warning_days),
            expirySalePolicy: row.expiry_sale_policy,
            batchCostPolicy: row.batch_cost_policy,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    // =========================================================================
    // 2. PRODUCT BATCHES
    // =========================================================================
    createBatch(batch) {
        const id = batch.id || (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const prodId = String(batch.productId);
        const supId = batch.supplierId ? String(batch.supplierId) : null;
        this.db.prepare(`
      INSERT INTO product_batches (
        id, business_id, product_id, batch_number, manufacturing_date,
        expiry_date, supplier_id, purchase_document_line_id, status,
        cost_minor, initial_quantity_scaled, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, batch.businessId, prodId, batch.batchNumber.trim(), batch.manufacturingDate || null, batch.expiryDate || null, supId, batch.purchaseDocumentLineId || null, batch.status || 'active', batch.costMinor || 0, batch.initialQuantityScaled || 0, batch.notes || null, now, now);
        return this.findById(id);
    }
    findById(batchId) {
        const row = this.db.prepare(`
      SELECT b.*,
             p.name as product_name, p.sku,
             s.name as supplier_name
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN suppliers s ON b.supplier_id = s.id
      WHERE b.id = ?
    `).get(batchId);
        if (!row)
            return null;
        return this.mapBatchRow(row);
    }
    findByProductAndNumber(productId, batchNumber, businessId) {
        const row = this.db.prepare(`
      SELECT b.*,
             p.name as product_name, p.sku,
             s.name as supplier_name
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN suppliers s ON b.supplier_id = s.id
      WHERE b.business_id = ? AND b.product_id = ? AND b.batch_number = ?
    `).get(businessId, String(productId), batchNumber.trim());
        if (!row)
            return null;
        return this.mapBatchRow(row);
    }
    listBatches(filter) {
        let sql = `
      SELECT b.*,
             p.name as product_name, p.sku,
             s.name as supplier_name
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN suppliers s ON b.supplier_id = s.id
      WHERE b.business_id = ?
    `;
        const params = [filter.businessId];
        if (filter.productId) {
            sql += ' AND b.product_id = ?';
            params.push(String(filter.productId));
        }
        if (filter.status) {
            sql += ' AND b.status = ?';
            params.push(filter.status);
        }
        if (filter.locationId) {
            sql += ' AND b.id IN (SELECT batch_id FROM batch_stock_balances WHERE stock_location_id = ? AND on_hand_scaled > 0)';
            params.push(filter.locationId);
        }
        sql += ' ORDER BY b.expiry_date ASC, b.created_at ASC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => this.mapBatchRow(r));
    }
    updateStatus(batchId, status, notes) {
        const now = new Date().toISOString();
        let sql = 'UPDATE product_batches SET status = ?, updated_at = ?';
        const params = [status, now];
        if (notes) {
            sql += ", notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | ' || ? END";
            params.push(notes, notes);
        }
        sql += ' WHERE id = ?';
        params.push(batchId);
        this.db.prepare(sql).run(...params);
    }
    // =========================================================================
    // 3. BATCH STOCK BALANCES
    // =========================================================================
    getBatchBalance(batchId, stockLocationId, businessId) {
        const row = this.db.prepare(`
      SELECT b.*,
             pb.batch_number, pb.expiry_date, pb.status,
             loc.name as location_name
      FROM batch_stock_balances b
      JOIN product_batches pb ON b.batch_id = pb.id
      LEFT JOIN stock_locations loc ON b.stock_location_id = loc.id
      WHERE b.business_id = ? AND b.batch_id = ? AND b.stock_location_id = ?
    `).get(businessId, batchId, stockLocationId);
        if (!row)
            return null;
        const onHand = Number(row.on_hand_scaled) || 0;
        const reserved = Number(row.reserved_scaled) || 0;
        return {
            id: row.id,
            businessId: row.business_id,
            batchId: row.batch_id,
            stockLocationId: row.stock_location_id,
            onHandScaled: onHand,
            reservedScaled: reserved,
            availableScaled: Math.max(0, onHand - reserved),
            updatedAt: row.updated_at,
            batchNumber: row.batch_number,
            expiryDate: row.expiry_date,
            status: row.status,
            locationName: row.location_name
        };
    }
    upsertBalanceDelta(params) {
        const onHandDelta = params.onHandDeltaScaled || 0;
        const reservedDelta = params.reservedDeltaScaled || 0;
        const now = new Date().toISOString();
        const existing = this.getBatchBalance(params.batchId, params.stockLocationId, params.businessId);
        if (existing) {
            const newOnHand = existing.onHandScaled + onHandDelta;
            const newReserved = existing.reservedScaled + reservedDelta;
            this.db.prepare(`
        UPDATE batch_stock_balances
        SET on_hand_scaled = ?,
            reserved_scaled = ?,
            updated_at = ?
        WHERE id = ?
      `).run(newOnHand, newReserved, now, existing.id);
            return this.getBatchBalance(params.batchId, params.stockLocationId, params.businessId);
        }
        const id = (0, crypto_1.randomUUID)();
        this.db.prepare(`
      INSERT INTO batch_stock_balances (
        id, business_id, batch_id, stock_location_id,
        on_hand_scaled, reserved_scaled, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.businessId, params.batchId, params.stockLocationId, Math.max(0, onHandDelta), Math.max(0, reservedDelta), now);
        return this.getBatchBalance(params.batchId, params.stockLocationId, params.businessId);
    }
    // =========================================================================
    // 4. FEFO CANDIDATE BATCHES
    // =========================================================================
    getFefoEligibleBatches(productId, stockLocationId, businessId) {
        const rows = this.db.prepare(`
      SELECT pb.id, pb.batch_number, pb.expiry_date, pb.created_at, pb.cost_minor,
             bal.on_hand_scaled, bal.reserved_scaled
      FROM batch_stock_balances bal
      JOIN product_batches pb ON bal.batch_id = pb.id
      WHERE bal.business_id = ?
        AND pb.product_id = ?
        AND bal.stock_location_id = ?
        AND pb.status = 'active'
        AND (bal.on_hand_scaled - bal.reserved_scaled) > 0
    `).all(businessId, String(productId), stockLocationId);
        return rows.map((r) => {
            const onHand = Number(r.on_hand_scaled) || 0;
            const reserved = Number(r.reserved_scaled) || 0;
            return {
                id: r.id,
                batchNumber: r.batch_number,
                expiryDate: r.expiry_date,
                createdAt: r.created_at,
                onHandScaled: onHand,
                reservedScaled: reserved,
                availableScaled: Math.max(0, onHand - reserved),
                costMinor: Number(r.cost_minor) || 0
            };
        });
    }
    // =========================================================================
    // 5. SALE ITEM BATCHES & TRACEABILITY
    // =========================================================================
    recordSaleItemBatch(entry) {
        const id = entry.id || (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO sale_item_batches (
        id, business_id, sale_id, sale_item_id, product_id, batch_id, quantity_scaled, unit_cost_minor, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.businessId, String(entry.saleId), String(entry.saleItemId), String(entry.productId), entry.batchId, entry.quantityScaled, entry.unitCostMinor || 0, now);
    }
    listBatchesForSale(saleId) {
        const rows = this.db.prepare(`
      SELECT sib.*,
             pb.batch_number, pb.expiry_date
      FROM sale_item_batches sib
      JOIN product_batches pb ON sib.batch_id = pb.id
      WHERE sib.sale_id = ?
    `).all(String(saleId));
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            saleId: r.sale_id,
            saleItemId: r.sale_item_id,
            productId: r.product_id,
            batchId: r.batch_id,
            quantityScaled: Number(r.quantity_scaled),
            unitCostMinor: Number(r.unit_cost_minor),
            createdAt: r.created_at,
            batchNumber: r.batch_number,
            expiryDate: r.expiry_date
        }));
    }
    getSalesForBatch(batchId) {
        const rows = this.db.prepare(`
      SELECT s.id as sale_id, s.invoice_number, s.created_at as sale_date,
             s.customer_id, c.name as customer_name, c.phone as customer_phone,
             sib.quantity_scaled, i.unit_price, (sib.quantity_scaled * i.unit_price / 1000) as line_total_minor
      FROM sale_item_batches sib
      JOIN sales s ON sib.sale_id = s.id
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN sale_items i ON sib.sale_item_id = i.id
      WHERE sib.batch_id = ?
      ORDER BY s.created_at DESC
    `).all(batchId);
        return rows.map((r) => ({
            saleId: r.sale_id,
            invoiceNumber: r.invoice_number,
            saleDate: r.sale_date,
            customerId: r.customer_id,
            customerName: r.customer_name || 'Walk-in Customer',
            customerPhone: r.customer_phone || 'N/A',
            quantitySold: Number(r.quantity_scaled) / 1000,
            unitPriceMinor: Number(r.unit_price) || 0,
            lineTotalMinor: Math.round(Number(r.line_total_minor) || 0)
        }));
    }
    // =========================================================================
    // 6. BATCH REPORTS
    // =========================================================================
    getBatchStockReport(businessId, locationId) {
        let sql = `
      SELECT pb.id as batch_id, pb.batch_number, pb.product_id, pb.manufacturing_date, pb.expiry_date,
             pb.status, pb.cost_minor,
             p.name as product_name, p.sku,
             loc.id as location_id, loc.name as location_name,
             bal.on_hand_scaled, bal.reserved_scaled,
             s.name as supplier_name
      FROM batch_stock_balances bal
      JOIN product_batches pb ON bal.batch_id = pb.id
      JOIN products p ON pb.product_id = p.id
      JOIN stock_locations loc ON bal.stock_location_id = loc.id
      LEFT JOIN suppliers s ON pb.supplier_id = s.id
      WHERE bal.business_id = ?
    `;
        const params = [businessId];
        if (locationId) {
            sql += ' AND bal.stock_location_id = ?';
            params.push(locationId);
        }
        sql += ' ORDER BY pb.expiry_date ASC, p.name ASC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => this.mapReportItem(r));
    }
    getExpiringSoonBatches(businessId, daysThreshold = 30, locationId) {
        const all = this.getBatchStockReport(businessId, locationId);
        return all.filter((item) => {
            if (item.availableQuantity <= 0 || item.status === 'closed')
                return false;
            if (!item.expiryDate)
                return false;
            const days = batch_expiry_math_1.BatchExpiryMath.calculateDaysUntilExpiry(item.expiryDate, daysThreshold).daysRemaining;
            return days >= 0 && days <= daysThreshold;
        });
    }
    getExpiredBatches(businessId, locationId) {
        const all = this.getBatchStockReport(businessId, locationId);
        return all.filter((item) => {
            if (item.availableQuantity <= 0 || item.status === 'closed')
                return false;
            if (!item.expiryDate)
                return false;
            const days = batch_expiry_math_1.BatchExpiryMath.calculateDaysUntilExpiry(item.expiryDate).daysRemaining;
            return days < 0;
        });
    }
    getRecalledBatches(businessId) {
        const all = this.getBatchStockReport(businessId);
        return all.filter((item) => item.status === 'recalled');
    }
    mapBatchRow(r) {
        return {
            id: r.id,
            businessId: r.business_id,
            productId: r.product_id,
            batchNumber: r.batch_number,
            manufacturingDate: r.manufacturing_date,
            expiryDate: r.expiry_date,
            supplierId: r.supplier_id,
            purchaseDocumentLineId: r.purchase_document_line_id,
            status: r.status,
            costMinor: Number(r.cost_minor) || 0,
            initialQuantityScaled: Number(r.initial_quantity_scaled) || 0,
            notes: r.notes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            productName: r.product_name,
            sku: r.sku,
            supplierName: r.supplier_name
        };
    }
    mapReportItem(r) {
        const onHand = Number(r.on_hand_scaled) || 0;
        const reserved = Number(r.reserved_scaled) || 0;
        const available = Math.max(0, onHand - reserved);
        const cost = Number(r.cost_minor) || 0;
        const days = r.expiry_date
            ? batch_expiry_math_1.BatchExpiryMath.calculateDaysUntilExpiry(r.expiry_date).daysRemaining
            : null;
        return {
            batchId: r.batch_id,
            batchNumber: r.batch_number,
            productId: r.product_id,
            productName: r.product_name,
            sku: r.sku,
            locationId: r.location_id,
            locationName: r.location_name,
            onHandQuantity: onHand / 1000,
            reservedQuantity: reserved / 1000,
            availableQuantity: available / 1000,
            costMinor: cost,
            totalValuationMinor: Math.round((onHand / 1000) * cost),
            manufacturingDate: r.manufacturing_date,
            expiryDate: r.expiry_date,
            daysUntilExpiry: days,
            status: r.status,
            supplierName: r.supplier_name
        };
    }
}
exports.BatchRepository = BatchRepository;
