"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryCostRepository = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../connection");
class InventoryCostRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    getDb() {
        return this.db;
    }
    /**
     * Creates an incoming FIFO cost layer.
     */
    addCostLayer(layer) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const remaining = layer.remainingQuantityScaled !== undefined ? layer.remainingQuantityScaled : layer.receivedQuantityScaled;
        const receivedAt = layer.receivedAt || now;
        const currency = layer.currencyCode || 'PKR';
        let validSourceMovementId = null;
        if (layer.sourceMovementId) {
            const exists = this.db.prepare('SELECT 1 FROM stock_movements WHERE id = ?').get(layer.sourceMovementId);
            if (exists) {
                validSourceMovementId = layer.sourceMovementId;
            }
        }
        this.db.prepare(`
      INSERT INTO inventory_cost_layers (
        id, business_id, product_id, variant_id, stock_location_id,
        source_movement_id, received_quantity_scaled, remaining_quantity_scaled,
        unit_cost_minor, currency_code, received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, layer.businessId, String(layer.productId), layer.variantId ? String(layer.variantId) : null, layer.stockLocationId, validSourceMovementId, layer.receivedQuantityScaled, remaining, layer.unitCostMinor, currency, receivedAt, now);
        return {
            id,
            businessId: layer.businessId,
            productId: layer.productId,
            variantId: layer.variantId,
            stockLocationId: layer.stockLocationId,
            sourceMovementId: layer.sourceMovementId,
            receivedQuantityScaled: layer.receivedQuantityScaled,
            remainingQuantityScaled: remaining,
            unitCostMinor: layer.unitCostMinor,
            currencyCode: currency,
            receivedAt,
            createdAt: now
        };
    }
    /**
     * Retrieves active cost layers for a product at a location in strict FIFO order:
     * oldest received_at first, then oldest created_at.
     */
    getActiveCostLayers(productId, stockLocationId, businessId, variantId) {
        let sql = `
      SELECT * FROM inventory_cost_layers
      WHERE business_id = ?
        AND product_id = ?
        AND stock_location_id = ?
        AND remaining_quantity_scaled > 0
    `;
        const params = [businessId, String(productId), stockLocationId];
        if (variantId !== undefined && variantId !== null) {
            sql += ' AND variant_id = ?';
            params.push(String(variantId));
        }
        else {
            sql += ' AND variant_id IS NULL';
        }
        sql += ' ORDER BY received_at ASC, created_at ASC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            productId: r.product_id,
            variantId: r.variant_id,
            stockLocationId: r.stock_location_id,
            sourceMovementId: r.source_movement_id,
            receivedQuantityScaled: Number(r.received_quantity_scaled),
            remainingQuantityScaled: Number(r.remaining_quantity_scaled),
            unitCostMinor: Number(r.unit_cost_minor),
            currencyCode: r.currency_code,
            receivedAt: r.received_at,
            createdAt: r.created_at
        }));
    }
    /**
     * Depletes quantity from a cost layer.
     */
    depleteCostLayer(layerId, quantityToDepleteScaled) {
        this.db.prepare(`
      UPDATE inventory_cost_layers
      SET remaining_quantity_scaled = remaining_quantity_scaled - ?
      WHERE id = ?
    `).run(quantityToDepleteScaled, layerId);
    }
    /**
     * Restores quantity to a cost layer (e.g. sale reversal or cancellation).
     */
    restoreCostLayer(layerId, quantityToRestoreScaled) {
        this.db.prepare(`
      UPDATE inventory_cost_layers
      SET remaining_quantity_scaled = remaining_quantity_scaled + ?
      WHERE id = ?
    `).run(quantityToRestoreScaled, layerId);
    }
    /**
     * Records an inventory cost allocation for an outbound movement or sale line.
     */
    createCostAllocation(alloc) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        let validOutboundMovementId = null;
        if (alloc.outboundMovementId) {
            const exists = this.db.prepare('SELECT 1 FROM stock_movements WHERE id = ?').get(alloc.outboundMovementId);
            if (exists) {
                validOutboundMovementId = alloc.outboundMovementId;
            }
        }
        this.db.prepare(`
      INSERT INTO inventory_cost_allocations (
        id, business_id, product_id, stock_location_id, outbound_movement_id, cost_layer_id,
        reference_type, reference_id, reference_line_id,
        quantity_scaled, unit_cost_minor, allocated_cost_minor,
        is_provisional, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, alloc.businessId, alloc.productId ? String(alloc.productId) : null, alloc.stockLocationId || null, validOutboundMovementId, alloc.costLayerId || null, alloc.referenceType || null, alloc.referenceId || null, alloc.referenceLineId || null, alloc.quantityScaled, alloc.unitCostMinor, alloc.allocatedCostMinor, alloc.isProvisional ? 1 : 0, now);
        return {
            id,
            businessId: alloc.businessId,
            outboundMovementId: validOutboundMovementId || undefined,
            costLayerId: alloc.costLayerId,
            referenceType: alloc.referenceType,
            referenceId: alloc.referenceId,
            referenceLineId: alloc.referenceLineId,
            quantityScaled: alloc.quantityScaled,
            unitCostMinor: alloc.unitCostMinor,
            allocatedCostMinor: alloc.allocatedCostMinor,
            isProvisional: alloc.isProvisional,
            createdAt: now
        };
    }
    /**
     * Retrieves cost allocations for an outbound reference (e.g. sale item or transfer line).
     */
    getAllocationsByReference(businessId, referenceType, referenceId, referenceLineId) {
        let sql = `
      SELECT * FROM inventory_cost_allocations
      WHERE business_id = ? AND reference_type = ? AND reference_id = ?
    `;
        const params = [businessId, referenceType, referenceId];
        if (referenceLineId) {
            sql += ' AND reference_line_id = ?';
            params.push(referenceLineId);
        }
        sql += ' ORDER BY created_at ASC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            outboundMovementId: r.outbound_movement_id,
            costLayerId: r.cost_layer_id,
            referenceType: r.reference_type,
            referenceId: r.reference_id,
            referenceLineId: r.reference_line_id,
            quantityScaled: Number(r.quantity_scaled),
            unitCostMinor: Number(r.unit_cost_minor),
            allocatedCostMinor: Number(r.allocated_cost_minor),
            isProvisional: Boolean(r.is_provisional),
            createdAt: r.created_at
        }));
    }
    /**
     * Retrieves Weighted Average cost balance for a product at a location.
     */
    getCostBalance(productId, stockLocationId, businessId, variantId) {
        let sql = `
      SELECT * FROM inventory_cost_balances
      WHERE business_id = ? AND product_id = ? AND stock_location_id = ?
    `;
        const params = [businessId, String(productId), stockLocationId];
        if (variantId !== undefined && variantId !== null) {
            sql += ' AND variant_id = ?';
            params.push(String(variantId));
        }
        else {
            sql += ' AND variant_id IS NULL';
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
            quantityScaled: Number(row.quantity_scaled),
            inventoryValueMinor: Number(row.inventory_value_minor),
            averageUnitCostNumerator: Number(row.average_unit_cost_numerator),
            averageUnitCostDenominator: Number(row.average_unit_cost_denominator),
            updatedAt: row.updated_at
        };
    }
    /**
     * Inserts or updates a Weighted Average cost balance record atomically.
     */
    upsertCostBalance(balance) {
        const existing = this.getCostBalance(balance.productId, balance.stockLocationId, balance.businessId, balance.variantId);
        const now = new Date().toISOString();
        if (existing) {
            this.db.prepare(`
        UPDATE inventory_cost_balances
        SET quantity_scaled = ?,
            inventory_value_minor = ?,
            average_unit_cost_numerator = ?,
            average_unit_cost_denominator = ?,
            updated_at = ?
        WHERE id = ?
      `).run(balance.quantityScaled, balance.inventoryValueMinor, balance.averageUnitCostNumerator, balance.averageUnitCostDenominator, now, existing.id);
            return {
                ...existing,
                quantityScaled: balance.quantityScaled,
                inventoryValueMinor: balance.inventoryValueMinor,
                averageUnitCostNumerator: balance.averageUnitCostNumerator,
                averageUnitCostDenominator: balance.averageUnitCostDenominator,
                updatedAt: now
            };
        }
        else {
            const id = (0, crypto_1.randomUUID)();
            this.db.prepare(`
        INSERT INTO inventory_cost_balances (
          id, business_id, product_id, variant_id, stock_location_id,
          quantity_scaled, inventory_value_minor, average_unit_cost_numerator,
          average_unit_cost_denominator, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, balance.businessId, String(balance.productId), balance.variantId ? String(balance.variantId) : null, balance.stockLocationId, balance.quantityScaled, balance.inventoryValueMinor, balance.averageUnitCostNumerator, balance.averageUnitCostDenominator, now);
            return {
                id,
                businessId: balance.businessId,
                productId: balance.productId,
                variantId: balance.variantId,
                stockLocationId: balance.stockLocationId,
                quantityScaled: balance.quantityScaled,
                inventoryValueMinor: balance.inventoryValueMinor,
                averageUnitCostNumerator: balance.averageUnitCostNumerator,
                averageUnitCostDenominator: balance.averageUnitCostDenominator,
                updatedAt: now
            };
        }
    }
    /**
     * Records a controlled inventory revaluation.
     */
    recordRevaluation(reval) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        this.db.prepare(`
      INSERT INTO inventory_revaluations (
        id, business_id, product_id, stock_location_id,
        old_cost_method, new_cost_method, old_inventory_value_minor,
        new_inventory_value_minor, revaluation_variance_minor,
        reason, approved_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, reval.businessId, String(reval.productId), reval.stockLocationId, reval.oldCostMethod, reval.newCostMethod, reval.oldInventoryValueMinor, reval.newInventoryValueMinor, reval.revaluationVarianceMinor, reval.reason, reval.approvedBy, now);
        return {
            id,
            businessId: reval.businessId,
            productId: reval.productId,
            stockLocationId: reval.stockLocationId,
            oldCostMethod: reval.oldCostMethod,
            newCostMethod: reval.newCostMethod,
            oldInventoryValueMinor: reval.oldInventoryValueMinor,
            newInventoryValueMinor: reval.newInventoryValueMinor,
            revaluationVarianceMinor: reval.revaluationVarianceMinor,
            reason: reval.reason,
            approvedBy: reval.approvedBy,
            createdAt: now
        };
    }
    /**
     * Retrieves the timestamp of the latest outbound transaction for a product.
     */
    getLatestOutboundTime(businessId, productId, stockLocationId) {
        const row = this.db.prepare(`
      SELECT MAX(created_at) as latest_time
      FROM inventory_cost_allocations
      WHERE business_id = ?
        AND reference_type IN ('SALE', 'TRANSFER', 'ADJUSTMENT')
        AND cost_layer_id IN (
          SELECT id FROM inventory_cost_layers
          WHERE business_id = ? AND product_id = ? AND stock_location_id = ?
        )
    `).get(businessId, businessId, String(productId), stockLocationId);
        return row?.latest_time || null;
    }
    /**
     * Retrieves open provisional allocations for a product at a location.
     */
    getOpenProvisionalAllocations(businessId, productId) {
        const rows = this.db.prepare(`
      SELECT a.* FROM inventory_cost_allocations a
      LEFT JOIN stock_movements m ON a.outbound_movement_id = m.id
      WHERE a.business_id = ?
        AND (a.product_id = ? OR m.product_id = ?)
        AND a.is_provisional = 1
      ORDER BY a.created_at ASC
    `).all(businessId, String(productId), String(productId));
        return rows.map((r) => ({
            id: r.id,
            businessId: r.business_id,
            outboundMovementId: r.outbound_movement_id,
            costLayerId: r.cost_layer_id,
            referenceType: r.reference_type,
            referenceId: r.reference_id,
            referenceLineId: r.reference_line_id,
            quantityScaled: Number(r.quantity_scaled),
            unitCostMinor: Number(r.unit_cost_minor),
            allocatedCostMinor: Number(r.allocated_cost_minor),
            isProvisional: Boolean(r.is_provisional),
            createdAt: r.created_at
        }));
    }
}
exports.InventoryCostRepository = InventoryCostRepository;
