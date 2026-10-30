"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodsReceiptRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
class GoodsReceiptRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    // =========================================================================
    // 1. SETTINGS
    // =========================================================================
    getSettings(businessId) {
        const row = this.db.prepare(`
      SELECT * FROM goods_receipt_settings WHERE business_id = ?
    `).get(businessId);
        if (!row)
            return null;
        return {
            id: row.id,
            businessId: row.business_id,
            allowDirectReceipt: Boolean(row.allow_direct_receipt),
            requireInspection: Boolean(row.require_inspection),
            quarantineLocationId: row.quarantine_location_id,
            damagedLocationId: row.damaged_location_id,
            overDeliveryPolicy: row.over_delivery_policy,
            overDeliveryTolerancePercent: Number(row.over_delivery_tolerance_percent),
            provisionalCostPolicy: row.provisional_cost_policy,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    upsertSettings(settings) {
        const existing = this.getSettings(settings.businessId);
        const now = new Date().toISOString();
        if (existing) {
            this.db.prepare(`
        UPDATE goods_receipt_settings
        SET allow_direct_receipt = COALESCE(?, allow_direct_receipt),
            require_inspection = COALESCE(?, require_inspection),
            quarantine_location_id = COALESCE(?, quarantine_location_id),
            damaged_location_id = COALESCE(?, damaged_location_id),
            over_delivery_policy = COALESCE(?, over_delivery_policy),
            over_delivery_tolerance_percent = COALESCE(?, over_delivery_tolerance_percent),
            provisional_cost_policy = COALESCE(?, provisional_cost_policy),
            updated_at = ?
        WHERE business_id = ?
      `).run(settings.allowDirectReceipt !== undefined ? (settings.allowDirectReceipt ? 1 : 0) : null, settings.requireInspection !== undefined ? (settings.requireInspection ? 1 : 0) : null, settings.quarantineLocationId, settings.damagedLocationId, settings.overDeliveryPolicy, settings.overDeliveryTolerancePercent, settings.provisionalCostPolicy, now, settings.businessId);
        }
        else {
            const id = (0, crypto_1.randomUUID)();
            this.db.prepare(`
        INSERT INTO goods_receipt_settings (
          id, business_id, allow_direct_receipt, require_inspection,
          quarantine_location_id, damaged_location_id, over_delivery_policy,
          over_delivery_tolerance_percent, provisional_cost_policy, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, settings.businessId, settings.allowDirectReceipt !== undefined ? (settings.allowDirectReceipt ? 1 : 0) : 1, settings.requireInspection !== undefined ? (settings.requireInspection ? 1 : 0) : 0, settings.quarantineLocationId || null, settings.damagedLocationId || null, settings.overDeliveryPolicy || 'reject', settings.overDeliveryTolerancePercent || 0, settings.provisionalCostPolicy || 'last_purchase_price', now, now);
        }
        return this.getSettings(settings.businessId);
    }
    // =========================================================================
    // 2. RECEIPT QUERIES
    // =========================================================================
    findById(id, businessId) {
        let sql = `
      SELECT gr.*,
             b.name as branch_name,
             po.purchase_order_number,
             s.name as supplier_name,
             s.supplier_code,
             loc.name as stock_location_name,
             u_rec.full_name as received_by_name,
             u_app.full_name as approved_by_name,
             u_post.full_name as posted_by_name
      FROM goods_receipts gr
      LEFT JOIN branches b ON gr.branch_id = b.id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      JOIN suppliers s ON gr.supplier_id = s.id
      JOIN stock_locations loc ON gr.stock_location_id = loc.id
      LEFT JOIN users u_rec ON gr.received_by = CAST(u_rec.id AS TEXT)
      LEFT JOIN users u_app ON gr.approved_by = CAST(u_app.id AS TEXT)
      LEFT JOIN users u_post ON gr.posted_by = CAST(u_post.id AS TEXT)
      WHERE gr.id = ?
    `;
        const params = [id];
        if (businessId) {
            sql += ' AND gr.business_id = ?';
            params.push(businessId);
        }
        const row = this.db.prepare(sql).get(...params);
        if (!row)
            return null;
        const receipt = this.mapReceiptRow(row);
        receipt.lines = this.getLines(receipt.id);
        return receipt;
    }
    findByReceiptNumber(businessId, receiptNumber) {
        const row = this.db.prepare(`
      SELECT id FROM goods_receipts WHERE business_id = ? AND receipt_number = ?
    `).get(businessId, receiptNumber);
        return row ? this.findById(row.id, businessId) : null;
    }
    findByIdempotencyKey(businessId, idempotencyKey) {
        const row = this.db.prepare(`
      SELECT id FROM goods_receipts WHERE business_id = ? AND idempotency_key = ?
    `).get(businessId, idempotencyKey);
        return row ? this.findById(row.id, businessId) : null;
    }
    // =========================================================================
    // 3. RECEIPT MUTATIONS
    // =========================================================================
    create(receipt, lines) {
        const receiptId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            // 1. Insert header
            this.db.prepare(`
        INSERT INTO goods_receipts (
          id, business_id, branch_id, purchase_order_id, supplier_id,
          receipt_number, supplier_delivery_note, received_at, stock_location_id,
          status, notes, received_by, approved_by, approved_at, posted_by, posted_at,
          idempotency_key, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
      `).run(receiptId, receipt.businessId, receipt.branchId, receipt.purchaseOrderId || null, receipt.supplierId, receipt.receiptNumber, receipt.supplierDeliveryNote || null, receipt.receivedAt || now, receipt.stockLocationId, receipt.status, receipt.notes || null, String(receipt.receivedBy || '1'), receipt.approvedBy ? String(receipt.approvedBy) : null, receipt.approvedAt || null, receipt.postedBy ? String(receipt.postedBy) : null, receipt.postedAt || null, receipt.idempotencyKey, now, now);
            // 2. Insert lines
            const lineInsert = this.db.prepare(`
        INSERT INTO goods_receipt_lines (
          id, goods_receipt_id, purchase_order_line_id, product_id, variant_id,
          batch_id, batch_number, expiry_date, manufacturing_date,
          purchase_unit_id, conversion_numerator, conversion_denominator,
          received_quantity_scaled, accepted_quantity_scaled, rejected_quantity_scaled,
          damaged_quantity_scaled, base_accepted_quantity_scaled, base_damaged_quantity_scaled,
          base_rejected_quantity_scaled, unit_cost_minor, discrepancy_type, discrepancy_reason,
          notes, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
      `);
            const serialInsert = this.db.prepare(`
        INSERT INTO goods_receipt_serials (
          id, goods_receipt_id, goods_receipt_line_id, serial_number_id,
          serial_number, manufacturer_serial, imei_1, imei_2, condition, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const line of lines) {
                const lineId = (0, crypto_1.randomUUID)();
                lineInsert.run(lineId, receiptId, line.purchaseOrderLineId || null, String(line.productId), line.variantId ? String(line.variantId) : null, line.batchId || null, line.batchNumber || null, line.expiryDate || null, line.manufacturingDate || null, String(line.purchaseUnitId), line.conversionNumerator || 1, line.conversionDenominator || 1, line.receivedQuantityScaled, line.acceptedQuantityScaled, line.rejectedQuantityScaled || 0, line.damagedQuantityScaled || 0, line.baseAcceptedQuantityScaled || 0, line.baseDamagedQuantityScaled || 0, line.baseRejectedQuantityScaled || 0, line.unitCostMinor || null, line.discrepancyType || null, line.discrepancyReason || null, line.notes || null, now, now);
                if (line.serials && line.serials.length > 0) {
                    for (const s of line.serials) {
                        serialInsert.run((0, crypto_1.randomUUID)(), receiptId, lineId, null, s.serialNumber, s.manufacturerSerial || null, s.imei1 || null, s.imei2 || null, s.condition || 'accepted', s.notes || null, now);
                    }
                }
            }
        });
        tx();
        return this.findById(receiptId, receipt.businessId);
    }
    updateStatus(id, status, metadata) {
        const now = new Date().toISOString();
        let sql = `UPDATE goods_receipts SET status = ?, updated_at = ?`;
        const params = [status, now];
        if (metadata?.approvedBy) {
            sql += `, approved_by = ?, approved_at = ?`;
            params.push(metadata.approvedBy, metadata.approvedAt || now);
        }
        if (metadata?.postedBy) {
            sql += `, posted_by = ?, posted_at = ?`;
            params.push(metadata.postedBy, metadata.postedAt || now);
        }
        sql += ` WHERE id = ?`;
        params.push(id);
        this.db.prepare(sql).run(...params);
    }
    updateLinesInspection(receiptId, inspectedLines) {
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            const updateStmt = this.db.prepare(`
        UPDATE goods_receipt_lines
        SET accepted_quantity_scaled = ?,
            rejected_quantity_scaled = ?,
            damaged_quantity_scaled = ?,
            base_accepted_quantity_scaled = ?,
            base_damaged_quantity_scaled = ?,
            base_rejected_quantity_scaled = ?,
            discrepancy_type = ?,
            discrepancy_reason = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ? AND goods_receipt_id = ?
      `);
            const serialInsert = this.db.prepare(`
        INSERT INTO goods_receipt_serials (
          id, goods_receipt_id, goods_receipt_line_id, serial_number_id,
          serial_number, manufacturer_serial, imei_1, imei_2, condition, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const line of inspectedLines) {
                updateStmt.run(line.acceptedQuantityScaled, line.rejectedQuantityScaled, line.damagedQuantityScaled, line.baseAcceptedQuantityScaled, line.baseDamagedQuantityScaled, line.baseRejectedQuantityScaled, line.discrepancyType || null, line.discrepancyReason || null, line.notes || null, now, line.goodsReceiptLineId, receiptId);
                if (line.serials && line.serials.length > 0) {
                    this.db.prepare(`DELETE FROM goods_receipt_serials WHERE goods_receipt_line_id = ?`).run(line.goodsReceiptLineId);
                    for (const s of line.serials) {
                        serialInsert.run((0, crypto_1.randomUUID)(), receiptId, line.goodsReceiptLineId, null, s.serialNumber, s.manufacturerSerial || null, s.imei1 || null, s.imei2 || null, s.condition || 'accepted', s.notes || null, now);
                    }
                }
            }
        });
        tx();
    }
    // =========================================================================
    // 4. LINES & SERIALS QUERIES
    // =========================================================================
    getLines(goodsReceiptId) {
        const rows = this.db.prepare(`
      SELECT l.*,
             p.name as product_name,
             p.sku as product_sku,
             p.barcode as product_barcode,
             u.name as purchase_unit_name,
             COALESCE(l.batch_number, b.batch_number) as resolved_batch_number,
             COALESCE(l.expiry_date, b.expiry_date) as resolved_expiry_date,
             COALESCE(l.manufacturing_date, b.manufacturing_date) as resolved_manufacturing_date
      FROM goods_receipt_lines l
      JOIN products p ON l.product_id = p.id
      JOIN units u ON l.purchase_unit_id = u.id
      LEFT JOIN product_batches b ON l.batch_id = b.id
      WHERE l.goods_receipt_id = ?
      ORDER BY l.rowid ASC
    `).all(goodsReceiptId);
        const serials = this.getSerials(goodsReceiptId);
        const serialsByLine = new Map();
        for (const s of serials) {
            if (!serialsByLine.has(s.goodsReceiptLineId)) {
                serialsByLine.set(s.goodsReceiptLineId, []);
            }
            serialsByLine.get(s.goodsReceiptLineId).push(s);
        }
        return rows.map((r) => ({
            id: r.id,
            goodsReceiptId: r.goods_receipt_id,
            purchaseOrderLineId: r.purchase_order_line_id,
            productId: r.product_id,
            productName: r.product_name,
            productSku: r.product_sku,
            productBarcode: r.product_barcode,
            variantId: r.variant_id,
            batchId: r.batch_id,
            batchNumber: r.resolved_batch_number || r.batch_number || null,
            expiryDate: r.resolved_expiry_date || r.expiry_date || null,
            manufacturingDate: r.resolved_manufacturing_date || r.manufacturing_date || null,
            purchaseUnitId: r.purchase_unit_id,
            purchaseUnitName: r.purchase_unit_name,
            conversionNumerator: Number(r.conversion_numerator),
            conversionDenominator: Number(r.conversion_denominator),
            receivedQuantityScaled: Number(r.received_quantity_scaled),
            acceptedQuantityScaled: Number(r.accepted_quantity_scaled),
            rejectedQuantityScaled: Number(r.rejected_quantity_scaled),
            damagedQuantityScaled: Number(r.damaged_quantity_scaled),
            baseAcceptedQuantityScaled: Number(r.base_accepted_quantity_scaled),
            baseDamagedQuantityScaled: Number(r.base_damaged_quantity_scaled),
            baseRejectedQuantityScaled: Number(r.base_rejected_quantity_scaled),
            unitCostMinor: r.unit_cost_minor !== null ? Number(r.unit_cost_minor) : null,
            discrepancyType: r.discrepancy_type,
            discrepancyReason: r.discrepancy_reason,
            notes: r.notes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            serials: serialsByLine.get(r.id) || []
        }));
    }
    getSerials(goodsReceiptId, lineId) {
        let sql = `SELECT * FROM goods_receipt_serials WHERE goods_receipt_id = ?`;
        const params = [goodsReceiptId];
        if (lineId) {
            sql += ` AND goods_receipt_line_id = ?`;
            params.push(lineId);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => ({
            id: r.id,
            goodsReceiptId: r.goods_receipt_id,
            goodsReceiptLineId: r.goods_receipt_line_id,
            serialNumberId: r.serial_number_id,
            serialNumber: r.serial_number,
            manufacturerSerial: r.manufacturer_serial,
            imei1: r.imei_1,
            imei2: r.imei_2,
            condition: r.condition,
            notes: r.notes,
            createdAt: r.created_at
        }));
    }
    // =========================================================================
    // 5. SEARCH & DISCREPANCY REPORTING
    // =========================================================================
    search(query) {
        let where = `WHERE gr.business_id = ?`;
        const params = [query.businessId];
        if (query.branchId) {
            where += ` AND gr.branch_id = ?`;
            params.push(query.branchId);
        }
        if (query.supplierId) {
            where += ` AND gr.supplier_id = ?`;
            params.push(query.supplierId);
        }
        if (query.purchaseOrderId) {
            where += ` AND gr.purchase_order_id = ?`;
            params.push(query.purchaseOrderId);
        }
        if (query.status) {
            if (Array.isArray(query.status)) {
                where += ` AND gr.status IN (${query.status.map(() => '?').join(',')})`;
                params.push(...query.status);
            }
            else {
                where += ` AND gr.status = ?`;
                params.push(query.status);
            }
        }
        if (query.search) {
            where += ` AND (gr.receipt_number LIKE ? OR gr.supplier_delivery_note LIKE ? OR s.name LIKE ?)`;
            const term = `%${query.search}%`;
            params.push(term, term, term);
        }
        if (query.startDate) {
            where += ` AND gr.received_at >= ?`;
            params.push(query.startDate);
        }
        if (query.endDate) {
            where += ` AND gr.received_at <= ?`;
            params.push(query.endDate);
        }
        const countRow = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM goods_receipts gr
      JOIN suppliers s ON gr.supplier_id = s.id
      ${where}
    `).get(...params);
        const limit = query.limit || 50;
        const offset = query.offset || 0;
        const rows = this.db.prepare(`
      SELECT gr.*,
             b.name as branch_name,
             po.purchase_order_number,
             s.name as supplier_name,
             s.supplier_code,
             loc.name as stock_location_name,
             u_rec.full_name as received_by_name,
             u_app.full_name as approved_by_name,
             u_post.full_name as posted_by_name
      FROM goods_receipts gr
      LEFT JOIN branches b ON gr.branch_id = b.id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      JOIN suppliers s ON gr.supplier_id = s.id
      JOIN stock_locations loc ON gr.stock_location_id = loc.id
      LEFT JOIN users u_rec ON gr.received_by = CAST(u_rec.id AS TEXT)
      LEFT JOIN users u_app ON gr.approved_by = CAST(u_app.id AS TEXT)
      LEFT JOIN users u_post ON gr.posted_by = CAST(u_post.id AS TEXT)
      ${where}
      ORDER BY gr.received_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
        return {
            receipts: rows.map((r) => this.mapReceiptRow(r)),
            total: countRow?.count || 0
        };
    }
    getDiscrepancyReport(businessId, purchaseOrderId) {
        let sql = `
      SELECT gr.id as receipt_id,
             gr.receipt_number,
             po.purchase_order_number,
             s.name as supplier_name,
             gr.received_at,
             l.product_id,
             p.name as product_name,
             COALESCE(pol.ordered_quantity_scaled, 0) as ordered_quantity_scaled,
             l.received_quantity_scaled,
             l.accepted_quantity_scaled,
             l.rejected_quantity_scaled,
             l.damaged_quantity_scaled,
             l.discrepancy_type,
             l.discrepancy_reason,
             l.unit_cost_minor
      FROM goods_receipt_lines l
      JOIN goods_receipts gr ON l.goods_receipt_id = gr.id
      JOIN products p ON l.product_id = p.id
      JOIN suppliers s ON gr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      LEFT JOIN purchase_order_lines pol ON l.purchase_order_line_id = pol.id
      WHERE gr.business_id = ?
        AND (
          l.rejected_quantity_scaled > 0
          OR l.damaged_quantity_scaled > 0
          OR l.discrepancy_type IS NOT NULL
          OR (pol.ordered_quantity_scaled IS NOT NULL AND l.received_quantity_scaled != pol.ordered_quantity_scaled)
        )
    `;
        const params = [businessId];
        if (purchaseOrderId) {
            sql += ` AND gr.purchase_order_id = ?`;
            params.push(purchaseOrderId);
        }
        sql += ` ORDER BY gr.received_at DESC`;
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => {
            const ordered = Number(r.ordered_quantity_scaled);
            const received = Number(r.received_quantity_scaled);
            const rejected = Number(r.rejected_quantity_scaled);
            const damaged = Number(r.damaged_quantity_scaled);
            const unitCost = Number(r.unit_cost_minor || 0);
            let discType = r.discrepancy_type;
            if (!discType) {
                if (damaged > 0)
                    discType = 'damaged_packaging';
                else if (rejected > 0)
                    discType = 'under_delivery';
                else if (ordered > 0 && received < ordered)
                    discType = 'under_delivery';
                else if (ordered > 0 && received > ordered)
                    discType = 'over_delivery';
                else
                    discType = 'other';
            }
            // Financial impact = damaged/rejected cost or variance cost
            const varianceScaled = (rejected + damaged) || Math.abs(received - ordered);
            const financialImpactMinor = Math.round((varianceScaled / 1000) * unitCost);
            return {
                receiptId: r.receipt_id,
                receiptNumber: r.receipt_number,
                purchaseOrderNumber: r.purchase_order_number,
                supplierName: r.supplier_name,
                receivedAt: r.received_at,
                productId: r.product_id,
                productName: r.product_name,
                orderedQuantityScaled: ordered,
                receivedQuantityScaled: received,
                acceptedQuantityScaled: Number(r.accepted_quantity_scaled),
                rejectedQuantityScaled: rejected,
                damagedQuantityScaled: damaged,
                discrepancyType: discType,
                discrepancyReason: r.discrepancy_reason || `Discrepancy: ${discType}`,
                unitCostMinor: unitCost,
                financialImpactMinor
            };
        });
    }
    mapReceiptRow(row) {
        return {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            branchName: row.branch_name,
            purchaseOrderId: row.purchase_order_id,
            purchaseOrderNumber: row.purchase_order_number,
            supplierId: row.supplier_id,
            supplierName: row.supplier_name,
            supplierCode: row.supplier_code,
            receiptNumber: row.receipt_number,
            supplierDeliveryNote: row.supplier_delivery_note,
            receivedAt: row.received_at,
            stockLocationId: row.stock_location_id,
            stockLocationName: row.stock_location_name,
            status: row.status,
            notes: row.notes,
            receivedBy: row.received_by,
            receivedByName: row.received_by_name,
            approvedBy: row.approved_by,
            approvedByName: row.approved_by_name,
            approvedAt: row.approved_at,
            postedBy: row.posted_by,
            postedByName: row.posted_by_name,
            postedAt: row.posted_at,
            idempotencyKey: row.idempotency_key,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
exports.GoodsReceiptRepository = GoodsReceiptRepository;
