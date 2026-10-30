"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockBalanceRepository = void 0;
const connection_1 = require("../connection");
const stock_location_rules_1 = require("../../../domain/inventory/stock-location-rules");
class StockBalanceRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    getBalance(productId, stockLocationId, businessId, variantId) {
        let sql = `
      SELECT b.*,
             p.name AS product_name,
             p.sku AS product_sku,
             c.name AS category_name,
             u.name AS base_unit_name
      FROM stock_balances b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE b.product_id = ? AND b.stock_location_id = ? AND b.business_id = ?
    `;
        const params = [String(productId), stockLocationId, businessId];
        if (variantId !== undefined && variantId !== null) {
            sql += ' AND b.variant_id = ?';
            params.push(String(variantId));
        }
        else {
            sql += ' AND b.variant_id IS NULL';
        }
        const row = this.db.prepare(sql).get(...params);
        if (!row)
            return null;
        return {
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            variantId: row.variant_id,
            stockLocationId: row.stock_location_id,
            onHandScaled: Number(row.on_hand_scaled),
            reservedScaled: Number(row.reserved_scaled),
            availableScaled: Number(row.available_scaled),
            lastMovementAt: row.last_movement_at,
            updatedAt: row.updated_at,
            productName: row.product_name,
            productSku: row.product_sku,
            categoryName: row.category_name,
            baseUnitName: row.base_unit_name
        };
    }
    upsertDelta(params) {
        const pId = String(params.productId);
        const vId = params.variantId ? String(params.variantId) : null;
        const reservedDelta = params.reservedDeltaScaled || 0;
        const current = this.getBalance(pId, params.stockLocationId, params.businessId, vId);
        if (!current) {
            const id = crypto.randomUUID();
            const onHand = params.onHandDeltaScaled;
            const reserved = reservedDelta;
            const available = stock_location_rules_1.StockLocationRules.calculateAvailableStock(onHand, reserved);
            this.db
                .prepare(`INSERT INTO stock_balances (
            id, business_id, product_id, variant_id, stock_location_id,
            on_hand_scaled, reserved_scaled, available_scaled, last_movement_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')))`)
                .run(id, params.businessId, pId, vId, params.stockLocationId, onHand, reserved, available);
            return this.getBalance(pId, params.stockLocationId, params.businessId, vId);
        }
        const newOnHand = current.onHandScaled + params.onHandDeltaScaled;
        const newReserved = current.reservedScaled + reservedDelta;
        const newAvailable = stock_location_rules_1.StockLocationRules.calculateAvailableStock(newOnHand, newReserved);
        this.db
            .prepare(`UPDATE stock_balances
         SET on_hand_scaled = ?,
             reserved_scaled = ?,
             available_scaled = ?,
             last_movement_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
             updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE id = ?`)
            .run(newOnHand, newReserved, newAvailable, current.id);
        return this.getBalance(pId, params.stockLocationId, params.businessId, vId);
    }
    getLocationBalances(locationId, businessId, filter) {
        let sql = `
      SELECT b.*,
             p.name AS product_name,
             p.sku AS product_sku,
             c.name AS category_name,
             u.name AS base_unit_name
      FROM stock_balances b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE b.stock_location_id = ? AND b.business_id = ?
    `;
        const params = [locationId, businessId];
        if (filter?.productId) {
            sql += ' AND b.product_id = ?';
            params.push(String(filter.productId));
        }
        if (filter?.categoryId) {
            sql += ' AND p.category_id = ?';
            params.push(String(filter.categoryId));
        }
        if (filter?.search) {
            sql += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
            params.push(`%${filter.search}%`, `%${filter.search}%`);
        }
        if (filter?.onlyInStock) {
            sql += ' AND b.on_hand_scaled > 0';
        }
        sql += ' ORDER BY p.name ASC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => ({
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            variantId: row.variant_id,
            stockLocationId: row.stock_location_id,
            onHandScaled: Number(row.on_hand_scaled),
            reservedScaled: Number(row.reserved_scaled),
            availableScaled: Number(row.available_scaled),
            lastMovementAt: row.last_movement_at,
            updatedAt: row.updated_at,
            productName: row.product_name,
            productSku: row.product_sku,
            categoryName: row.category_name,
            baseUnitName: row.base_unit_name
        }));
    }
    getProductBalances(productId, businessId) {
        const rows = this.db
            .prepare(`SELECT b.*,
                p.name AS product_name,
                p.sku AS product_sku,
                c.name AS category_name,
                u.name AS base_unit_name
         FROM stock_balances b
         JOIN products p ON b.product_id = p.id
         LEFT JOIN product_categories c ON p.category_id = c.id
         LEFT JOIN units u ON p.base_unit_id = u.id
         WHERE b.product_id = ? AND b.business_id = ?
         ORDER BY b.stock_location_id ASC`)
            .all(String(productId), businessId);
        return rows.map((row) => ({
            id: row.id,
            businessId: row.business_id,
            productId: row.product_id,
            variantId: row.variant_id,
            stockLocationId: row.stock_location_id,
            onHandScaled: Number(row.on_hand_scaled),
            reservedScaled: Number(row.reserved_scaled),
            availableScaled: Number(row.available_scaled),
            lastMovementAt: row.last_movement_at,
            updatedAt: row.updated_at,
            productName: row.product_name,
            productSku: row.product_sku,
            categoryName: row.category_name,
            baseUnitName: row.base_unit_name
        }));
    }
    getBranchTotalOnHand(branchId, productId, businessId) {
        const row = this.db
            .prepare(`SELECT COALESCE(SUM(b.on_hand_scaled), 0) AS total_scaled
         FROM stock_balances b
         JOIN stock_locations l ON b.stock_location_id = l.id
         WHERE l.branch_id = ? AND b.product_id = ? AND b.business_id = ?`)
            .get(branchId, String(productId), businessId);
        return Number(row?.total_scaled || 0);
    }
    getBranchSellableOnHand(branchId, productId, businessId) {
        const row = this.db
            .prepare(`SELECT COALESCE(SUM(b.on_hand_scaled), 0) AS total_scaled
         FROM stock_balances b
         JOIN stock_locations l ON b.stock_location_id = l.id
         WHERE l.branch_id = ?
           AND b.product_id = ?
           AND b.business_id = ?
           AND l.is_sellable = 1
           AND l.is_active = 1
           AND l.location_type NOT IN ('damaged', 'quarantine')`)
            .get(branchId, String(productId), businessId);
        return Number(row?.total_scaled || 0);
    }
}
exports.StockBalanceRepository = StockBalanceRepository;
