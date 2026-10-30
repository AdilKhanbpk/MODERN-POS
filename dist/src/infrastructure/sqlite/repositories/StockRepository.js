"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockRepository = void 0;
const connection_1 = require("../connection");
const accounts_1 = require("../../../shared/constants/accounts");
const StockBalanceRepository_1 = require("./StockBalanceRepository");
class StockRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Permanent audit trail: Record stock movement and atomically update the stock balance projection.
     * Rule: stock_balances is never directly edited; it is updated only in tandem with a movement.
     */
    recordMovement(movement) {
        const variantId = movement.variantId || 0;
        const batchId = movement.batchId || 0;
        const locId = movement.locationId || 1;
        const cols = this.db.prepare("PRAGMA table_info('stock_balances')").all().map(c => c.name);
        const hasOnHand = cols.includes('on_hand_scaled');
        // 1. Fetch current stock balance projection
        let previousStock = 0;
        if (hasOnHand) {
            const balanceRow = this.db.prepare(`
        SELECT on_hand_scaled as qty
        FROM stock_balances
        WHERE product_id = ?
      `).get(String(movement.productId));
            previousStock = balanceRow ? (balanceRow.qty / 1000) : 0;
        }
        else {
            const balanceRow = this.db.prepare(`
        SELECT quantity_base_scaled as qty
        FROM stock_balances
        WHERE product_id = ? AND variant_id = ? AND location_id = ? AND batch_id = ?
      `).get(movement.productId, variantId, locId, batchId);
            previousStock = balanceRow ? balanceRow.qty : 0;
        }
        const newStock = Math.round((previousStock + movement.quantityBaseScaled) * 10000) / 10000;
        // 2. Insert immutable stock_movements entry
        const info = this.db.prepare(`
      INSERT INTO stock_movements (
        product_id, variant_id, location_id, batch_id, serial_id,
        movement_type, quantity, quantity_base_scaled,
        previous_stock, new_stock, source_type, source_id,
        reference_type, reference_id, reason, user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(movement.productId, movement.variantId || null, locId, movement.batchId || null, movement.serialId || null, movement.movementType, Math.abs(movement.quantityBaseScaled), movement.quantityBaseScaled, previousStock, newStock, movement.sourceType, movement.sourceId, movement.sourceType, movement.sourceId, movement.reason || null, movement.userId || null);
        // 3. Atomically update stock_balances projection
        if (hasOnHand) {
            const loc = this.db.prepare("SELECT id, business_id FROM stock_locations WHERE is_default = 1 LIMIT 1").get();
            if (loc) {
                const balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
                const currentBal = balanceRepo.getBalance(movement.productId, loc.id, loc.business_id, null);
                const currentOnHand = currentBal ? currentBal.onHandScaled : 0;
                const targetOnHand = Math.round(newStock * 1000);
                const delta = targetOnHand - currentOnHand;
                balanceRepo.upsertDelta({
                    businessId: loc.business_id,
                    productId: movement.productId,
                    stockLocationId: loc.id,
                    onHandDeltaScaled: delta
                });
            }
        }
        else {
            this.db.prepare(`
        INSERT INTO stock_balances (product_id, variant_id, location_id, batch_id, quantity_base_scaled)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(product_id, variant_id, location_id, batch_id) DO UPDATE SET
          quantity_base_scaled = excluded.quantity_base_scaled
      `).run(movement.productId, variantId, locId, batchId, newStock);
        }
        // 4. Update products.current_stock cached field
        this.db.prepare(`
      UPDATE products
      SET current_stock = ?
      WHERE id = ?
    `).run(newStock, movement.productId);
        return Number(info.lastInsertRowid);
    }
    getStockBalance(productId, locationId = 1, variantId = 0, batchId = 0) {
        const cols = this.db.prepare("PRAGMA table_info('stock_balances')").all().map(c => c.name);
        if (cols.includes('on_hand_scaled')) {
            const row = this.db.prepare(`
        SELECT on_hand_scaled as qty
        FROM stock_balances
        WHERE product_id = ?
      `).get(String(productId));
            return row ? (row.qty / 1000) : 0;
        }
        const row = this.db.prepare(`
      SELECT quantity_base_scaled as qty
      FROM stock_balances
      WHERE product_id = ? AND variant_id = ? AND location_id = ? AND batch_id = ?
    `).get(productId, variantId, locationId, batchId);
        return row ? row.qty : 0;
    }
    /**
     * Reconciles stock_movements total vs stock_balances projection.
     * If any drift or difference ever occurs, returns discrepancy details.
     */
    reconcileStock(productId, locationId = 1) {
        const cols = this.db.prepare("PRAGMA table_info('stock_balances')").all().map(c => c.name);
        const hasOnHand = cols.includes('on_hand_scaled');
        const movementSumRow = this.db.prepare(`
      SELECT COALESCE(SUM(quantity_base_scaled), 0) as total
      FROM stock_movements
      WHERE product_id = ?
    `).get(productId);
        let projected = 0;
        if (hasOnHand) {
            const balanceRow = this.db.prepare(`
        SELECT COALESCE(SUM(on_hand_scaled), 0) as total
        FROM stock_balances
        WHERE product_id = ?
      `).get(String(productId));
            projected = balanceRow.total / 1000;
        }
        else {
            const balanceRow = this.db.prepare(`
        SELECT COALESCE(SUM(quantity_base_scaled), 0) as total
        FROM stock_balances
        WHERE product_id = ? AND location_id = ?
      `).get(productId, locationId);
            projected = balanceRow.total;
        }
        const diff = Math.round((movementSumRow.total - projected) * 1000) / 1000;
        return {
            calculatedFromMovements: movementSumRow.total,
            projectedInBalance: projected,
            isReconciled: diff === 0,
            difference: diff
        };
    }
    /**
     * Stock adjustments header & lines
     */
    createAdjustment(adj) {
        const info = this.db.prepare(`
      INSERT INTO stock_adjustments (adjustment_number, location_id, reason, status, created_by)
      VALUES (?, ?, ?, 'APPROVED', ?)
    `).run(adj.adjustmentNumber, adj.locationId, adj.reason, adj.createdBy);
        const adjId = Number(info.lastInsertRowid);
        const insertLine = this.db.prepare(`
      INSERT INTO stock_adjustment_lines (adjustment_id, product_id, variant_id, system_qty_scaled, counted_qty_scaled, difference_qty_scaled)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const line of adj.lines) {
            const diff = line.countedQtyScaled - line.systemQtyScaled;
            insertLine.run(adjId, line.productId, line.variantId || null, line.systemQtyScaled, line.countedQtyScaled, diff);
            if (diff !== 0) {
                this.recordMovement({
                    productId: line.productId,
                    variantId: line.variantId,
                    locationId: adj.locationId,
                    movementType: diff > 0 ? accounts_1.StockMovementType.ADJUSTMENT_ADD : accounts_1.StockMovementType.ADJUSTMENT_DAMAGE,
                    quantityBaseScaled: diff,
                    sourceType: 'ADJUSTMENT',
                    sourceId: adjId,
                    reason: `Stock adjustment #${adj.adjustmentNumber}`,
                    userId: adj.createdBy
                });
            }
        }
        return adjId;
    }
    getMovementsForProduct(productId, limit = 50) {
        const rows = this.db.prepare(`
      SELECT id, product_id as productId, variant_id as variantId,
             location_id as locationId, batch_id as batchId, serial_id as serialId,
             movement_type as movementType, quantity,
             quantity_base_scaled as quantityBaseScaled,
             previous_stock as previousStock, new_stock as newStock,
             source_type as sourceType, source_id as sourceId,
             reason, user_id as userId, created_at as createdAt
      FROM stock_movements
      WHERE product_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(productId, limit);
        return rows;
    }
}
exports.StockRepository = StockRepository;
