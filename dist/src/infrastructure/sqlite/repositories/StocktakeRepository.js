"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StocktakeRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
const stocktake_rules_1 = require("../../../domain/inventory/stocktake-rules");
class StocktakeRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    getDb() {
        return this.db;
    }
    /**
     * Generates sequential stocktake number: STK-YYYY-XXXXX
     */
    generateStocktakeNumber(businessId) {
        const year = new Date().getFullYear();
        const prefix = `STK-${year}-`;
        const row = this.db
            .prepare(`SELECT stocktake_number FROM stocktakes
         WHERE business_id = ? AND stocktake_number LIKE ?
         ORDER BY stocktake_number DESC LIMIT 1`)
            .get(businessId, `${prefix}%`);
        let nextSeq = 1;
        if (row && row.stocktake_number) {
            const parts = row.stocktake_number.split('-');
            if (parts.length >= 3) {
                const parsed = parseInt(parts[2], 10);
                if (!isNaN(parsed)) {
                    nextSeq = parsed + 1;
                }
            }
        }
        return `${prefix}${String(nextSeq).padStart(5, '0')}`;
    }
    /**
     * Creates a stocktake record and captures initial system inventory snapshot.
     */
    createStocktake(dto, actorId) {
        const bizId = dto.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = dto.branchId || '00000000-0000-0000-0000-000000000002';
        const countingMode = dto.countingMode || 'blind';
        const freezeStock = dto.freezeStock ? 1 : 0;
        const stocktakeNumber = this.generateStocktakeNumber(bizId);
        const stocktakeId = (0, crypto_1.randomUUID)();
        const snapshotAt = new Date().toISOString();
        const insertStocktakeStmt = this.db.prepare(`
      INSERT INTO stocktakes (
        id, business_id, branch_id, stocktake_number, stock_location_id,
        count_mode, counting_mode, status, freeze_stock,
        scope_category_id, scope_config_json, snapshot_at,
        created_by, notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, 'draft', ?,
        ?, ?, ?,
        ?, ?
      )
    `);
        insertStocktakeStmt.run(stocktakeId, bizId, branchId, stocktakeNumber, dto.stockLocationId, dto.countMode, countingMode, freezeStock, dto.scopeCategoryId || null, dto.selectedProductIds ? JSON.stringify(dto.selectedProductIds) : null, snapshotAt, actorId, dto.notes || null);
        // Populate initial scoped snapshot lines
        this.captureSnapshotLines(stocktakeId, bizId, dto.stockLocationId, dto);
        return this.getStocktakeById(stocktakeId);
    }
    /**
     * Resolves products within the count scope and creates snapshot lines.
     */
    captureSnapshotLines(stocktakeId, businessId, stockLocationId, dto) {
        let productQuery = `
      SELECT p.id, p.base_unit_id, p.default_cost_minor, p.cost_price,
             u.id as unit_id, u.decimal_precision as unit_precision
      FROM products p
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE (p.business_id = ? OR p.business_id IS NULL)
        AND p.is_active = 1
    `;
        const params = [businessId];
        if (dto.countMode === 'category' && dto.scopeCategoryId) {
            productQuery += ` AND p.category_id = ?`;
            params.push(dto.scopeCategoryId);
        }
        else if (dto.countMode === 'selected_products' && dto.selectedProductIds && dto.selectedProductIds.length > 0) {
            const placeholders = dto.selectedProductIds.map(() => '?').join(',');
            productQuery += ` AND p.id IN (${placeholders})`;
            params.push(...dto.selectedProductIds);
        }
        const products = this.db.prepare(productQuery).all(...params);
        const lineInsertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO stocktake_lines (
        id, stocktake_id, product_id, variant_id, batch_id,
        system_quantity_scaled, counted_quantity_scaled, difference_quantity_scaled,
        unit_id, unit_cost_minor, difference_value_minor,
        count_status, cutoff_movements_qty_scaled, expected_quantity_scaled
      ) VALUES (
        ?, ?, ?, NULL, NULL,
        ?, NULL, NULL,
        ?, ?, NULL,
        'uncounted', 0, ?
      )
    `);
        for (const prod of products) {
            // Get current stock balance at this location
            const bal = this.db.prepare(`
        SELECT on_hand_scaled
        FROM stock_balances
        WHERE product_id = ? AND stock_location_id = ?
        LIMIT 1
      `).get(prod.id, stockLocationId);
            let currentStockScaled = 0;
            if (bal && bal.on_hand_scaled !== undefined) {
                currentStockScaled = Math.round(bal.on_hand_scaled);
            }
            else {
                // Fallback to product current_stock if balance row does not exist yet
                const prodStock = this.db.prepare('SELECT current_stock FROM products WHERE id = ?').get(prod.id);
                currentStockScaled = Math.round((prodStock?.current_stock || 0) * 1000);
            }
            const costMinor = prod.default_cost_minor ?? (prod.cost_price ?? 0);
            const unitId = prod.unit_id || prod.base_unit_id || '00000000-0000-0000-0000-000000000001';
            lineInsertStmt.run((0, crypto_1.randomUUID)(), stocktakeId, prod.id, currentStockScaled, unitId, costMinor, currentStockScaled);
        }
    }
    /**
     * Retrieves an active stocktake freezing a given location.
     */
    findActiveFrozenStocktake(stockLocationId) {
        const row = this.db.prepare(`
      SELECT id, stocktake_number
      FROM stocktakes
      WHERE stock_location_id = ?
        AND freeze_stock = 1
        AND status IN ('in_progress', 'count_submitted', 'review', 'approved')
      LIMIT 1
    `).get(stockLocationId);
        return row || null;
    }
    /**
     * Starts counting process.
     */
    startStocktake(id) {
        this.db.prepare(`
      UPDATE stocktakes
      SET status = 'in_progress',
          started_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'),
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ? AND status = 'draft'
    `).run(id);
    }
    /**
     * Records a count attempt for a product line.
     * Supports scanning by barcode, direct quantity entry, or incremental scanning (+1 per scan).
     */
    recordCount(dto, actorId) {
        const stocktake = this.db.prepare(`SELECT * FROM stocktakes WHERE id = ?`).get(dto.stocktakeId);
        if (!stocktake) {
            throw new Error(`Stocktake with ID ${dto.stocktakeId} not found.`);
        }
        if (stocktake.status !== 'in_progress' && stocktake.status !== 'review') {
            throw new Error(`Cannot record count when stocktake is in '${stocktake.status}' state.`);
        }
        // Resolve product ID
        let resolvedProductId = dto.productId;
        if (!resolvedProductId && dto.productBarcode) {
            const barcodeClean = dto.productBarcode.trim();
            const bRow = this.db.prepare(`
        SELECT product_id FROM product_barcodes
        WHERE (barcode_value = ? OR barcode = ?) AND is_active = 1
        LIMIT 1
      `).get(barcodeClean, barcodeClean);
            if (bRow) {
                resolvedProductId = bRow.product_id;
            }
            else {
                // Direct SKU search fallback
                const pRow = this.db.prepare(`
          SELECT id FROM products WHERE (sku = ? OR barcode = ?) AND is_active = 1 LIMIT 1
        `).get(barcodeClean, barcodeClean);
                if (pRow) {
                    resolvedProductId = pRow.id;
                }
            }
        }
        if (!resolvedProductId) {
            throw new Error(`Product not found for barcode/identifier: '${dto.productBarcode || 'unknown'}'.`);
        }
        // Look for existing line
        let line = this.db.prepare(`
      SELECT * FROM stocktake_lines
      WHERE stocktake_id = ? AND product_id = ?
    `).get(dto.stocktakeId, resolvedProductId);
        // Dynamic found item support: If item was not in initial snapshot, create line with system_qty = 0
        if (!line) {
            const prod = this.db.prepare(`
        SELECT p.id, p.base_unit_id, p.default_cost_minor, p.cost_price, u.id as unit_id
        FROM products p
        LEFT JOIN units u ON p.base_unit_id = u.id
        WHERE p.id = ?
      `).get(resolvedProductId);
            if (!prod) {
                throw new Error(`Product with ID ${resolvedProductId} does not exist.`);
            }
            const newLineId = (0, crypto_1.randomUUID)();
            const unitId = prod.unit_id || prod.base_unit_id || '00000000-0000-0000-0000-000000000001';
            const costMinor = prod.default_cost_minor ?? (prod.cost_price ?? 0);
            this.db.prepare(`
        INSERT INTO stocktake_lines (
          id, stocktake_id, product_id, system_quantity_scaled,
          unit_id, unit_cost_minor, count_status, cutoff_movements_qty_scaled, expected_quantity_scaled
        ) VALUES (?, ?, ?, 0, ?, ?, 'uncounted', 0, 0)
      `).run(newLineId, dto.stocktakeId, resolvedProductId, unitId, costMinor);
            line = this.db.prepare(`SELECT * FROM stocktake_lines WHERE id = ?`).get(newLineId);
        }
        // Determine count sequence
        const lastCount = this.db.prepare(`
      SELECT MAX(count_sequence) as max_seq FROM stocktake_count_entries
      WHERE stocktake_line_id = ?
    `).get(line.id);
        const nextSeq = dto.countSequence || (lastCount?.max_seq ? lastCount.max_seq + 1 : 1);
        // Calculate counted quantity
        let countedQty = 0;
        if (dto.incrementalScanQuantityScaled !== undefined) {
            const currentCount = line.counted_quantity_scaled || 0;
            countedQty = currentCount + dto.incrementalScanQuantityScaled;
        }
        else if (dto.countedQuantityScaled !== undefined) {
            countedQty = dto.countedQuantityScaled;
        }
        else {
            countedQty = 1000; // Default 1.000 unit
        }
        const countedAt = new Date().toISOString();
        // Reset previous accepted count entry for this line
        this.db.prepare(`
      UPDATE stocktake_count_entries SET is_accepted = 0 WHERE stocktake_line_id = ?
    `).run(line.id);
        // Insert count entry
        this.db.prepare(`
      INSERT INTO stocktake_count_entries (
        id, stocktake_line_id, count_sequence, counted_quantity_scaled,
        counted_by, counted_at, device_identifier, notes, is_accepted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(stocktake_line_id, count_sequence) DO UPDATE SET
        counted_quantity_scaled = excluded.counted_quantity_scaled,
        counted_by = excluded.counted_by,
        counted_at = excluded.counted_at,
        notes = excluded.notes,
        is_accepted = 1
    `).run((0, crypto_1.randomUUID)(), line.id, nextSeq, countedQty, actorId, countedAt, dto.deviceIdentifier || null, dto.notes || null);
        // Policy B: Reconcile concurrent movements between snapshot and count cutoff
        let cutoffMovements = 0;
        if (!stocktake.freeze_stock && stocktake.snapshot_at) {
            const movements = this.db.prepare(`
        SELECT movement_type, direction, quantity_scaled
        FROM stock_movements
        WHERE product_id = ?
          AND (stock_location_id = ? OR location_id = 1)
          AND occurred_at >= ?
          AND occurred_at <= ?
      `).all(resolvedProductId, stocktake.stock_location_id, stocktake.snapshot_at, countedAt);
            for (const m of movements) {
                const qty = m.quantity_scaled || 0;
                const dir = m.direction || (m.movement_type === 'SALE' ? 'OUT' : 'IN');
                cutoffMovements += dir === 'IN' ? qty : -qty;
            }
        }
        const expectedQty = stocktake_rules_1.StocktakeRules.calculateExpectedStock(line.system_quantity_scaled, cutoffMovements);
        const diffQty = stocktake_rules_1.StocktakeRules.calculateDifference(countedQty, expectedQty);
        const diffVal = stocktake_rules_1.StocktakeRules.calculateDifferenceValue(diffQty, line.unit_cost_minor);
        // Check policy thresholds for recount
        const policy = this.getPolicy(stocktake.business_id);
        let newStatus = 'counted';
        if (nextSeq === 1 && stocktake_rules_1.StocktakeRules.evaluateRecountRequirement(diffQty, diffVal, policy)) {
            newStatus = 'recount_required';
        }
        this.db.prepare(`
      UPDATE stocktake_lines
      SET counted_quantity_scaled = ?,
          difference_quantity_scaled = ?,
          difference_value_minor = ?,
          count_status = ?,
          counted_by = ?,
          counted_at = ?,
          cutoff_movements_qty_scaled = ?,
          expected_quantity_scaled = ?,
          notes = ?,
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(countedQty, diffQty, diffVal, newStatus, actorId, countedAt, cutoffMovements, expectedQty, dto.notes || line.notes, line.id);
        return this.getLineById(line.id);
    }
    /**
     * Resolves a discrepancy line via recount acceptance, supervisor override, or abandonment.
     */
    resolveDiscrepancy(dto, supervisorId) {
        const line = this.getLineById(dto.lineId);
        if (!line) {
            throw new Error(`Stocktake line ${dto.lineId} not found.`);
        }
        if (dto.action === 'abandon') {
            this.db.prepare(`
        UPDATE stocktake_lines
        SET count_status = 'abandoned',
            difference_quantity_scaled = 0,
            difference_value_minor = 0,
            notes = ?,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
        WHERE id = ?
      `).run(dto.notes || 'Count abandoned by supervisor', line.id);
            return this.getLineById(line.id);
        }
        let acceptedQty = line.countedQuantityScaled || 0;
        if (dto.action === 'accept_sequence' && dto.acceptedCountSequence) {
            const entry = this.db.prepare(`
        SELECT * FROM stocktake_count_entries
        WHERE stocktake_line_id = ? AND count_sequence = ?
      `).get(line.id, dto.acceptedCountSequence);
            if (!entry) {
                throw new Error(`Count sequence ${dto.acceptedCountSequence} does not exist for this line.`);
            }
            this.db.prepare(`UPDATE stocktake_count_entries SET is_accepted = 0 WHERE stocktake_line_id = ?`).run(line.id);
            this.db.prepare(`UPDATE stocktake_count_entries SET is_accepted = 1 WHERE id = ?`).run(entry.id);
            acceptedQty = entry.counted_quantity_scaled;
        }
        else if (dto.action === 'supervisor_override' && dto.supervisorQuantityScaled !== undefined) {
            acceptedQty = dto.supervisorQuantityScaled;
            // Add supervisor count entry
            const lastSeq = this.db.prepare(`
        SELECT MAX(count_sequence) as max_seq FROM stocktake_count_entries WHERE stocktake_line_id = ?
      `).get(line.id);
            const nextSeq = (lastSeq?.max_seq || 0) + 1;
            this.db.prepare(`UPDATE stocktake_count_entries SET is_accepted = 0 WHERE stocktake_line_id = ?`).run(line.id);
            this.db.prepare(`
        INSERT INTO stocktake_count_entries (
          id, stocktake_line_id, count_sequence, counted_quantity_scaled,
          counted_by, counted_at, notes, is_accepted
        ) VALUES (?, ?, ?, ?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'), ?, 1)
      `).run((0, crypto_1.randomUUID)(), line.id, nextSeq, acceptedQty, supervisorId, dto.notes || 'Supervisor manual override');
        }
        const expectedQty = line.expectedQuantityScaled ?? (line.systemQuantityScaled || 0);
        const diffQty = stocktake_rules_1.StocktakeRules.calculateDifference(acceptedQty, expectedQty);
        const diffVal = stocktake_rules_1.StocktakeRules.calculateDifferenceValue(diffQty, line.unitCostMinor);
        this.db.prepare(`
      UPDATE stocktake_lines
      SET counted_quantity_scaled = ?,
          difference_quantity_scaled = ?,
          difference_value_minor = ?,
          count_status = 'resolved',
          notes = ?,
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(acceptedQty, diffQty, diffVal, dto.notes || line.notes, line.id);
        return this.getLineById(line.id);
    }
    /**
     * Submits stocktake for review.
     */
    submitCounts(stocktakeId, actorId) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        stocktake_rules_1.StocktakeRules.validateStatusTransition(st.status, 'count_submitted');
        this.db.prepare(`
      UPDATE stocktakes
      SET status = 'count_submitted',
          submitted_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'),
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(stocktakeId);
    }
    /**
     * Moves stocktake into review state.
     */
    reviewStocktake(stocktakeId) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        stocktake_rules_1.StocktakeRules.validateStatusTransition(st.status, 'review');
        this.db.prepare(`
      UPDATE stocktakes
      SET status = 'review',
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(stocktakeId);
    }
    /**
     * Approves stocktake results.
     */
    approveStocktake(stocktakeId, approverId) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        stocktake_rules_1.StocktakeRules.validateStatusTransition(st.status, 'approved');
        this.db.prepare(`
      UPDATE stocktakes
      SET status = 'approved',
          approved_by = ?,
          approved_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'),
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(approverId, stocktakeId);
    }
    /**
     * Cancels a stocktake. Unlocks any location freeze.
     */
    cancelStocktake(stocktakeId, reason) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        stocktake_rules_1.StocktakeRules.validateStatusTransition(st.status, 'cancelled');
        this.db.prepare(`
      UPDATE stocktakes
      SET status = 'cancelled',
          notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | Cancelled: ' || ? END,
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      WHERE id = ?
    `).run(reason, reason, stocktakeId);
    }
    /**
     * Posts stocktake adjustments atomically:
     * 1. Validates status == 'approved'.
     * 2. Creates stock movements for each line with non-zero difference.
     * 3. Atomically updates stock_balances projection.
     * 4. Sets status = 'posted'.
     */
    postStocktake(stocktakeId, posterId) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        stocktake_rules_1.StocktakeRules.validateStatusTransition(st.status, 'posted');
        const lines = this.db.prepare(`
      SELECT * FROM stocktake_lines WHERE stocktake_id = ?
    `).all(stocktakeId);
        const postTx = this.db.transaction(() => {
            const now = new Date().toISOString();
            for (const line of lines) {
                if (line.count_status === 'abandoned')
                    continue;
                const diffQty = line.difference_quantity_scaled || 0;
                if (diffQty === 0)
                    continue; // No physical discrepancy
                const isSurplus = diffQty > 0;
                const movementType = isSurplus ? 'STOCKTAKE_SURPLUS' : 'STOCKTAKE_DEFICIT';
                const direction = isSurplus ? 'IN' : 'OUT';
                const absQtyScaled = Math.abs(diffQty);
                const unitCostMinor = line.unit_cost_minor || 0;
                const totalCostMinor = Math.round((absQtyScaled * unitCostMinor) / 1000);
                const idempotencyKey = `STK-${stocktakeId}-${line.id}`;
                // 1. Insert stock movement
                this.db.prepare(`
          INSERT INTO stock_movements (
            id, business_id, branch_id, product_id, stock_location_id,
            movement_type, direction, quantity_scaled, base_unit_id,
            unit_precision, unit_cost_minor, total_cost_minor,
            reference_type, reference_id, reference_line_id, idempotency_key,
            occurred_at, posted_at, created_by,
            location_id, quantity, quantity_base_scaled, source_type, source_id, reason
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            3, ?, ?,
            'STOCKTAKE', ?, ?, ?,
            ?, ?, ?,
            1, ?, ?, 'STOCKTAKE', 0, ?
          )
        `).run((0, crypto_1.randomUUID)(), st.businessId, st.branchId, line.product_id, st.stockLocationId, movementType, direction, absQtyScaled, line.unit_id, unitCostMinor, totalCostMinor, st.id, line.id, idempotencyKey, now, now, posterId, absQtyScaled / 1000, absQtyScaled / 1000, `Stocktake ${st.stocktakeNumber} variance adjustment`);
                // 2. Update stock balance projection
                const delta = isSurplus ? absQtyScaled : -absQtyScaled;
                const curBal = this.db.prepare(`
          SELECT id, on_hand_scaled, reserved_scaled, available_scaled
          FROM stock_balances
          WHERE product_id = ? AND stock_location_id = ?
          LIMIT 1
        `).get(line.product_id, st.stockLocationId);
                if (curBal) {
                    const newOnHand = curBal.on_hand_scaled + delta;
                    const newAvail = newOnHand - (curBal.reserved_scaled || 0);
                    this.db.prepare(`
            UPDATE stock_balances
            SET on_hand_scaled = ?,
                available_scaled = ?,
                last_movement_at = ?,
                updated_at = ?
            WHERE id = ?
          `).run(newOnHand, newAvail, now, now, curBal.id);
                }
                else {
                    this.db.prepare(`
            INSERT INTO stock_balances (
              id, business_id, product_id, variant_id, stock_location_id,
              on_hand_scaled, reserved_scaled, available_scaled, last_movement_at, updated_at
            ) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)
          `).run((0, crypto_1.randomUUID)(), st.businessId, line.product_id, st.stockLocationId, delta, delta, now, now);
                }
                // Also update products.current_stock cache for backward compatibility
                this.db.prepare(`
          UPDATE products
          SET current_stock = current_stock + ?
          WHERE id = ?
        `).run(delta / 1000, line.product_id);
            }
            // Mark stocktake posted
            this.db.prepare(`
        UPDATE stocktakes
        SET status = 'posted',
            posted_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'),
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
        WHERE id = ?
      `).run(stocktakeId);
        });
        postTx();
        return this.getStocktakeById(stocktakeId);
    }
    /**
     * Retrieves stocktake by ID with lines and count entries.
     */
    getStocktakeById(id) {
        const row = this.db.prepare(`
      SELECT st.*,
             l.name as location_name,
             u1.full_name as creator_name,
             u2.full_name as approver_name,
             c.name as scope_category_name
      FROM stocktakes st
      LEFT JOIN stock_locations l ON st.stock_location_id = l.id
      LEFT JOIN users u1 ON st.created_by = u1.id
      LEFT JOIN users u2 ON st.approved_by = u2.id
      LEFT JOIN product_categories c ON st.scope_category_id = c.id
      WHERE st.id = ?
    `).get(id);
        if (!row)
            return null;
        const lines = this.db.prepare(`
      SELECT l.*,
             p.name as product_name,
             p.sku as product_sku,
             p.barcode as product_barcode,
             u.name as unit_name,
             u.decimal_precision as unit_precision
      FROM stocktake_lines l
      JOIN products p ON l.product_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE l.stocktake_id = ?
      ORDER BY p.name ASC
    `).all(id);
        const countEntries = this.db.prepare(`
      SELECT ce.*, u.full_name as counter_name
      FROM stocktake_count_entries ce
      JOIN stocktake_lines l ON ce.stocktake_line_id = l.id
      LEFT JOIN users u ON ce.counted_by = u.id
      WHERE l.stocktake_id = ?
      ORDER BY ce.count_sequence ASC
    `).all(id);
        const entriesByLine = new Map();
        for (const e of countEntries) {
            const list = entriesByLine.get(e.stocktake_line_id) || [];
            list.push({
                id: e.id,
                stocktakeLineId: e.stocktake_line_id,
                countSequence: e.count_sequence,
                countedQuantityScaled: e.counted_quantity_scaled,
                countedBy: e.counted_by,
                counterName: e.counter_name,
                countedAt: e.counted_at,
                deviceIdentifier: e.device_identifier,
                notes: e.notes,
                isAccepted: Boolean(e.is_accepted)
            });
            entriesByLine.set(e.stocktake_line_id, list);
        }
        const mappedLines = lines.map((l) => ({
            id: l.id,
            stocktakeId: l.stocktake_id,
            productId: l.product_id,
            productName: l.product_name,
            productSku: l.product_sku,
            productBarcode: l.product_barcode,
            variantId: l.variant_id,
            batchId: l.batch_id,
            systemQuantityScaled: l.system_quantity_scaled,
            countedQuantityScaled: l.counted_quantity_scaled,
            differenceQuantityScaled: l.difference_quantity_scaled,
            unitId: l.unit_id,
            unitName: l.unit_name,
            unitPrecision: l.unit_precision || 3,
            unitCostMinor: l.unit_cost_minor,
            differenceValueMinor: l.difference_value_minor,
            countStatus: l.count_status,
            countedBy: l.counted_by,
            countedAt: l.counted_at,
            cutoffMovementsQtyScaled: l.cutoff_movements_qty_scaled || 0,
            expectedQuantityScaled: l.expected_quantity_scaled,
            notes: l.notes,
            createdAt: l.created_at,
            updatedAt: l.updated_at,
            countEntries: entriesByLine.get(l.id) || []
        }));
        return {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            stocktakeNumber: row.stocktake_number,
            stockLocationId: row.stock_location_id,
            locationName: row.location_name,
            countMode: row.count_mode,
            countingMode: row.counting_mode,
            status: row.status,
            freezeStock: Boolean(row.freeze_stock),
            scopeCategoryId: row.scope_category_id,
            scopeCategoryName: row.scope_category_name,
            scopeConfigJson: row.scope_config_json,
            snapshotAt: row.snapshot_at,
            startedAt: row.started_at,
            submittedAt: row.submitted_at,
            approvedAt: row.approved_at,
            postedAt: row.posted_at,
            createdBy: row.created_by,
            creatorName: row.creator_name,
            approvedBy: row.approved_by,
            approverName: row.approver_name,
            notes: row.notes,
            idempotencyKey: row.idempotency_key,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            totalLinesCount: mappedLines.length,
            countedLinesCount: mappedLines.filter((l) => l.countStatus !== 'uncounted').length,
            discrepancyLinesCount: mappedLines.filter((l) => (l.differenceQuantityScaled || 0) !== 0).length,
            lines: mappedLines
        };
    }
    /**
     * Retrieves single line with its count entries.
     */
    getLineById(id) {
        const l = this.db.prepare(`
      SELECT l.*,
             p.name as product_name,
             p.sku as product_sku,
             p.barcode as product_barcode,
             u.name as unit_name,
             u.decimal_precision as unit_precision
      FROM stocktake_lines l
      JOIN products p ON l.product_id = p.id
      LEFT JOIN units u ON l.unit_id = u.id
      WHERE l.id = ?
    `).get(id);
        if (!l)
            return null;
        const entries = this.db.prepare(`
      SELECT ce.*, u.full_name as counter_name
      FROM stocktake_count_entries ce
      LEFT JOIN users u ON ce.counted_by = u.id
      WHERE ce.stocktake_line_id = ?
      ORDER BY ce.count_sequence ASC
    `).all(id);
        return {
            id: l.id,
            stocktakeId: l.stocktake_id,
            productId: l.product_id,
            productName: l.product_name,
            productSku: l.product_sku,
            productBarcode: l.product_barcode,
            variantId: l.variant_id,
            batchId: l.batch_id,
            systemQuantityScaled: l.system_quantity_scaled,
            countedQuantityScaled: l.counted_quantity_scaled,
            differenceQuantityScaled: l.difference_quantity_scaled,
            unitId: l.unit_id,
            unitName: l.unit_name,
            unitPrecision: l.unit_precision || 3,
            unitCostMinor: l.unit_cost_minor,
            differenceValueMinor: l.difference_value_minor,
            countStatus: l.count_status,
            countedBy: l.counted_by,
            countedAt: l.counted_at,
            cutoffMovementsQtyScaled: l.cutoff_movements_qty_scaled || 0,
            expectedQuantityScaled: l.expected_quantity_scaled,
            notes: l.notes,
            createdAt: l.created_at,
            updatedAt: l.updated_at,
            countEntries: entries.map((e) => ({
                id: e.id,
                stocktakeLineId: e.stocktake_line_id,
                countSequence: e.count_sequence,
                countedQuantityScaled: e.counted_quantity_scaled,
                countedBy: e.counted_by,
                counterName: e.counter_name,
                countedAt: e.counted_at,
                deviceIdentifier: e.device_identifier,
                notes: e.notes,
                isAccepted: Boolean(e.is_accepted)
            }))
        };
    }
    /**
     * Lists stocktakes with filtering.
     */
    listStocktakes(filter) {
        let sql = `
      SELECT st.*,
             l.name as location_name,
             u1.full_name as creator_name,
             u2.full_name as approver_name,
             (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = st.id) as total_lines,
             (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = st.id AND count_status != 'uncounted') as counted_lines,
             (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = st.id AND difference_quantity_scaled != 0) as discrepancy_lines
      FROM stocktakes st
      LEFT JOIN stock_locations l ON st.stock_location_id = l.id
      LEFT JOIN users u1 ON st.created_by = u1.id
      LEFT JOIN users u2 ON st.approved_by = u2.id
      WHERE st.business_id = ?
    `;
        const params = [filter.businessId];
        if (filter.branchId) {
            sql += ` AND st.branch_id = ?`;
            params.push(filter.branchId);
        }
        if (filter.stockLocationId) {
            sql += ` AND st.stock_location_id = ?`;
            params.push(filter.stockLocationId);
        }
        if (filter.status) {
            sql += ` AND st.status = ?`;
            params.push(filter.status);
        }
        if (filter.countingMode) {
            sql += ` AND st.counting_mode = ?`;
            params.push(filter.countingMode);
        }
        if (filter.countMode) {
            sql += ` AND st.count_mode = ?`;
            params.push(filter.countMode);
        }
        sql += ` ORDER BY st.created_at DESC`;
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            branchId: r.branch_id,
            stocktakeNumber: r.stocktake_number,
            stockLocationId: r.stock_location_id,
            locationName: r.location_name,
            countMode: r.count_mode,
            countingMode: r.counting_mode,
            status: r.status,
            freezeStock: Boolean(r.freeze_stock),
            scopeCategoryId: r.scope_category_id,
            scopeConfigJson: r.scope_config_json,
            snapshotAt: r.snapshot_at,
            startedAt: r.started_at,
            submittedAt: r.submitted_at,
            approvedAt: r.approved_at,
            postedAt: r.posted_at,
            createdBy: r.created_by,
            creatorName: r.creator_name,
            approvedBy: r.approved_by,
            approverName: r.approver_name,
            notes: r.notes,
            idempotencyKey: r.idempotency_key,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            totalLinesCount: r.total_lines || 0,
            countedLinesCount: r.counted_lines || 0,
            discrepancyLinesCount: r.discrepancy_lines || 0
        }));
    }
    /**
     * Produces detailed stocktake report metrics.
     */
    generateStocktakeReport(stocktakeId) {
        const st = this.getStocktakeById(stocktakeId);
        if (!st)
            throw new Error(`Stocktake ${stocktakeId} not found.`);
        const policy = this.getPolicy(st.businessId);
        const lines = st.lines || [];
        let totalCounted = 0;
        let totalUncounted = 0;
        let exactMatch = 0;
        let surplusCount = 0;
        let deficitCount = 0;
        let disputedCount = 0;
        let abandonedCount = 0;
        let surplusQtyScaled = 0;
        let deficitQtyScaled = 0;
        let surplusValMinor = 0;
        let deficitValMinor = 0;
        for (const l of lines) {
            if (l.countStatus === 'uncounted') {
                totalUncounted++;
                continue;
            }
            totalCounted++;
            if (l.countStatus === 'abandoned') {
                abandonedCount++;
                continue;
            }
            if (l.countStatus === 'disputed' || l.countStatus === 'recount_required') {
                disputedCount++;
            }
            const diff = l.differenceQuantityScaled || 0;
            const val = l.differenceValueMinor || 0;
            if (diff === 0) {
                exactMatch++;
            }
            else if (diff > 0) {
                surplusCount++;
                surplusQtyScaled += diff;
                surplusValMinor += val;
            }
            else {
                deficitCount++;
                deficitQtyScaled += Math.abs(diff);
                deficitValMinor += Math.abs(val);
            }
        }
        const netQty = surplusQtyScaled - deficitQtyScaled;
        const netVal = surplusValMinor - deficitValMinor;
        const absVal = surplusValMinor + deficitValMinor;
        const totalCountable = lines.length;
        const discrepancyItems = surplusCount + deficitCount;
        const discrepancyRate = totalCountable > 0 ? (discrepancyItems / totalCountable) * 100 : 0;
        return {
            stocktake: st,
            metrics: {
                totalScopedItems: lines.length,
                totalCountedItems: totalCounted,
                totalUncountedItems: totalUncounted,
                exactMatchItems: exactMatch,
                surplusItemsCount: surplusCount,
                deficitItemsCount: deficitCount,
                disputedItemsCount: disputedCount,
                abandonedItemsCount: abandonedCount,
                totalSurplusQuantityScaled: surplusQtyScaled,
                totalDeficitQuantityScaled: deficitQtyScaled,
                netQuantityVarianceScaled: netQty,
                totalSurplusValueMinor: surplusValMinor,
                totalDeficitValueMinor: deficitValMinor,
                netMonetaryVarianceMinor: netVal,
                absoluteMonetaryVarianceMinor: absVal,
                discrepancyRatePercentage: Math.round(discrepancyRate * 100) / 100
            },
            policyApplied: {
                countingMode: st.countingMode,
                freezeStock: st.freezeStock,
                autoRecountQtyThresholdScaled: policy.autoRecountQtyThresholdScaled,
                autoRecountValueThresholdMinor: policy.autoRecountValueThresholdMinor
            },
            lines
        };
    }
    /**
     * Retrieves business stocktake policy.
     */
    getPolicy(businessId) {
        const row = this.db.prepare(`
      SELECT * FROM stocktake_policies WHERE business_id = ?
    `).get(businessId);
        if (row) {
            return {
                id: row.id,
                businessId: row.business_id,
                autoRecountQtyThresholdScaled: row.auto_recount_qty_threshold_scaled,
                autoRecountValueThresholdMinor: row.auto_recount_value_threshold_minor,
                allowBlindCounting: Boolean(row.allow_blind_counting),
                defaultCountingMode: row.default_counting_mode,
                allowEmergencyFreezeOverride: Boolean(row.allow_emergency_freeze_override),
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        }
        // Default policy
        return {
            id: (0, crypto_1.randomUUID)(),
            businessId,
            autoRecountQtyThresholdScaled: 5000,
            autoRecountValueThresholdMinor: 500000,
            allowBlindCounting: true,
            defaultCountingMode: 'blind',
            allowEmergencyFreezeOverride: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    /**
     * Updates or seeds stocktake policy.
     */
    updatePolicy(businessId, policy) {
        this.db.prepare(`
      INSERT INTO stocktake_policies (
        id, business_id, auto_recount_qty_threshold_scaled, auto_recount_value_threshold_minor,
        allow_blind_counting, default_counting_mode, allow_emergency_freeze_override,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
      )
      ON CONFLICT(business_id) DO UPDATE SET
        auto_recount_qty_threshold_scaled = COALESCE(?, auto_recount_qty_threshold_scaled),
        auto_recount_value_threshold_minor = COALESCE(?, auto_recount_value_threshold_minor),
        allow_blind_counting = COALESCE(?, allow_blind_counting),
        default_counting_mode = COALESCE(?, default_counting_mode),
        allow_emergency_freeze_override = COALESCE(?, allow_emergency_freeze_override),
        updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
    `).run((0, crypto_1.randomUUID)(), businessId, policy.autoRecountQtyThresholdScaled ?? 5000, policy.autoRecountValueThresholdMinor ?? 500000, policy.allowBlindCounting ? 1 : 0, policy.defaultCountingMode || 'blind', policy.allowEmergencyFreezeOverride ? 1 : 0, policy.autoRecountQtyThresholdScaled, policy.autoRecountValueThresholdMinor, policy.allowBlindCounting !== undefined ? (policy.allowBlindCounting ? 1 : 0) : null, policy.defaultCountingMode, policy.allowEmergencyFreezeOverride !== undefined ? (policy.allowEmergencyFreezeOverride ? 1 : 0) : null);
        return this.getPolicy(businessId);
    }
}
exports.StocktakeRepository = StocktakeRepository;
