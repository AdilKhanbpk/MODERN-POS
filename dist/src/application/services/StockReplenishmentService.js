"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockReplenishmentService = void 0;
const connection_1 = require("../../infrastructure/sqlite/connection");
const ReplenishmentRepository_1 = require("../../infrastructure/sqlite/repositories/ReplenishmentRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const UnitConversionService_1 = require("./UnitConversionService");
const PurchaseService_1 = require("./PurchaseService");
const replenishment_math_1 = require("../../domain/inventory/replenishment-math");
const replenishment_rules_1 = require("../../domain/inventory/replenishment-rules");
const stock_reservation_rules_1 = require("../../domain/inventory/stock-reservation-rules");
class StockReplenishmentService {
    db;
    repo;
    balanceRepo;
    productRepo;
    supplierRepo;
    locationRepo;
    conversionService;
    purchaseService;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.repo = new ReplenishmentRepository_1.ReplenishmentRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.supplierRepo = new SupplierRepository_1.SupplierRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
        this.conversionService = new UnitConversionService_1.UnitConversionService(this.db);
        this.purchaseService = new PurchaseService_1.PurchaseService();
        this.purchaseService.purchaseRepo.db = this.db;
        this.purchaseService.productRepo.db = this.db;
        this.purchaseService.supplierRepo.db = this.db;
    }
    /**
     * Configures or updates reorder rules for a product.
     */
    setReorderRule(dto) {
        replenishment_rules_1.ReplenishmentRules.validateReorderRule(dto);
        return this.repo.upsertReorderRule(dto);
    }
    /**
     * Retrieves reorder rule for product and location.
     */
    getReorderRule(productId, locationId, businessId) {
        return this.repo.getReorderRule(productId, locationId, businessId);
    }
    /**
     * Lists reorder rules for business.
     */
    listReorderRules(businessId, locationId) {
        return this.repo.listReorderRules(businessId, locationId);
    }
    /**
     * Scans inventory levels, applies demand forecasting rules, and generates actionable
     * replenishment suggestions without silently creating purchases.
     */
    generateReplenishmentSuggestions(filter) {
        const { businessId, branchId, stockLocationId, supplierId } = filter;
        const historyDays = filter.historyPeriodDays || 30;
        const sinceDate = new Date(Date.now() - historyDays * 86400000).toISOString();
        // 1. Fetch eligible active products
        let prodSql = `SELECT * FROM products WHERE is_active = 1`;
        const prodParams = [];
        if (this.db.prepare("PRAGMA table_info('products')").all().some(c => c.name === 'business_id')) {
            prodSql += ` AND (business_id = ? OR business_id IS NULL)`;
            prodParams.push(businessId);
        }
        const products = this.db.prepare(prodSql).all(...prodParams);
        // 2. Fetch target stock locations
        let locSql = `SELECT * FROM stock_locations WHERE business_id = ? AND is_active = 1 AND is_sellable = 1`;
        const locParams = [businessId];
        if (stockLocationId) {
            locSql += ` AND id = ?`;
            locParams.push(stockLocationId);
        }
        else if (branchId) {
            locSql += ` AND branch_id = ?`;
            locParams.push(branchId);
        }
        const locations = this.db.prepare(locSql).all(...locParams);
        const generated = [];
        for (const prod of products) {
            for (const loc of locations) {
                // Fetch reorder rule for product & location
                const rule = this.repo.getReorderRule(prod.id, loc.id, businessId);
                if (!rule || !rule.isActive)
                    continue;
                // Supplier filter check
                if (supplierId && String(rule.preferredSupplierId) !== String(supplierId)) {
                    continue;
                }
                // Current Inventory Balances
                const bal = this.balanceRepo.getBalance(prod.id, loc.id, businessId);
                const onHandScaled = bal ? bal.onHandScaled : 0;
                const reservedScaled = bal ? bal.reservedScaled : 0;
                const availableScaled = stock_reservation_rules_1.StockReservationRules.calculateAvailableStock(onHandScaled, reservedScaled);
                // In-transit incoming and on-order purchase orders
                let inTransitIncomingScaled = 0;
                let onOrderPoScaled = 0;
                if (filter.includeIncoming) {
                    inTransitIncomingScaled = this.repo.getInTransitIncomingScaled(prod.id, loc.id, businessId);
                    onOrderPoScaled = this.repo.getOnOrderPoQuantityScaled(prod.id, businessId);
                }
                const projectedAvailableScaled = availableScaled + inTransitIncomingScaled + onOrderPoScaled;
                // Sales Demand Analysis
                const salesStats = this.repo.getNetSalesQuantity(prod.id, businessId, loc.id, sinceDate);
                const avgDailyDemandScaled = replenishment_math_1.ReplenishmentMath.calculateAverageDailyDemand(salesStats.totalNetQuantityScaled, historyDays);
                // Demand forecast reliability evaluation
                const forecastEval = replenishment_rules_1.ReplenishmentRules.evaluateDemandForecast({
                    productCreatedAt: prod.created_at || new Date().toISOString(),
                    analysisPeriodDays: historyDays,
                    daysWithSales: salesStats.daysWithSales,
                    totalNetSalesScaled: salesStats.totalNetQuantityScaled,
                    averageDailyDemandScaled: avgDailyDemandScaled,
                    maxSingleDaySaleScaled: salesStats.maxSingleDaySaleScaled
                });
                // Compute dynamic reorder point if lead time is configured
                let effectiveReorderPointScaled = rule.reorderPointScaled;
                if (rule.leadTimeDays > 0 && avgDailyDemandScaled > 0) {
                    const dynamicRop = replenishment_math_1.ReplenishmentMath.calculateReorderPoint(avgDailyDemandScaled, rule.leadTimeDays, rule.safetyStockScaled);
                    // Use the higher of dynamic or configured manual reorder point
                    effectiveReorderPointScaled = Math.max(rule.reorderPointScaled, dynamicRop);
                }
                // Determine if replenishment should be triggered
                const isBelowRop = projectedAvailableScaled <= effectiveReorderPointScaled && effectiveReorderPointScaled > 0;
                const isBelowMin = projectedAvailableScaled < rule.minimumStockScaled && rule.minimumStockScaled > 0;
                const isOutOfStock = projectedAvailableScaled <= 0;
                if (!isBelowRop && !isBelowMin && !isOutOfStock) {
                    // Adequate inventory; no suggestion required
                    continue;
                }
                // Target stock calculation
                let targetStockScaled = rule.targetStockScaled;
                if (targetStockScaled <= 0) {
                    // Fallback target: reorder point + safety stock or minimum stock
                    targetStockScaled = Math.max(rule.minimumStockScaled, effectiveReorderPointScaled + rule.safetyStockScaled);
                }
                // Raw Shortfall
                const rawShortfallScaled = replenishment_math_1.ReplenishmentMath.calculateSimpleReorderQuantity(targetStockScaled, projectedAvailableScaled);
                if (rawShortfallScaled <= 0)
                    continue;
                // Packaging Unit Rounding (Cartons, Boxes, Cases)
                let packagingFactorScaled = 1000;
                let packagingUnitName = 'Piece';
                if (rule.preferredPurchaseUnitId) {
                    try {
                        const conversions = this.conversionService.getProductConversions(prod.id);
                        const conv = conversions.find((c) => String(c.fromUnitId) === String(rule.preferredPurchaseUnitId) || String(c.unitId) === String(rule.preferredPurchaseUnitId));
                        if (conv && conv.toBaseFactorNumerator > 0 && conv.toBaseFactorDenominator > 0) {
                            const factor = conv.toBaseFactorNumerator / conv.toBaseFactorDenominator;
                            packagingFactorScaled = Math.round(factor * 1000);
                            packagingUnitName = conv.fromUnitName || rule.purchaseUnitName || 'Packaging Unit';
                        }
                    }
                    catch {
                        // No direct conversion found; use base units
                    }
                }
                const rounding = replenishment_math_1.ReplenishmentMath.roundUpToPackagingUnits(rawShortfallScaled, packagingFactorScaled, packagingUnitName);
                const suggestedQuantityScaled = rounding.roundedQuantityScaled;
                // Assemble detailed calculation reason
                const reason = {
                    method: rule.leadTimeDays > 0 && avgDailyDemandScaled > 0 ? 'DEMAND_LEAD_TIME' : 'SIMPLE_REORDER',
                    analysisPeriodDays: historyDays,
                    averageDailyDemand: avgDailyDemandScaled / 1000,
                    leadTimeDays: rule.leadTimeDays,
                    safetyStock: rule.safetyStockScaled / 1000,
                    reorderPoint: effectiveReorderPointScaled / 1000,
                    targetStock: targetStockScaled / 1000,
                    onHand: onHandScaled / 1000,
                    reserved: reservedScaled / 1000,
                    available: availableScaled / 1000,
                    inTransitIncoming: inTransitIncomingScaled / 1000,
                    onOrderPO: onOrderPoScaled / 1000,
                    projectedAvailable: projectedAvailableScaled / 1000,
                    rawShortfall: rawShortfallScaled / 1000,
                    suggestedQuantity: suggestedQuantityScaled / 1000,
                    packagingUnit: packagingUnitName !== 'Piece' ? packagingUnitName : undefined,
                    conversionFactor: packagingFactorScaled > 1000 ? packagingFactorScaled / 1000 : undefined,
                    packagesCount: packagingFactorScaled > 1000 ? rounding.packagesCount : undefined,
                    roundedQuantity: packagingFactorScaled > 1000 ? suggestedQuantityScaled / 1000 : undefined,
                    roundingNote: packagingFactorScaled > 1000 ? rounding.explanation : undefined,
                    confidence: forecastEval.confidence,
                    flags: forecastEval.flags.length > 0 ? forecastEval.flags : undefined,
                    explanation: `Projected available stock (${projectedAvailableScaled / 1000}) is at or below threshold (${effectiveReorderPointScaled / 1000}). Target stock is ${targetStockScaled / 1000}. Suggested reorder: ${suggestedQuantityScaled / 1000} ${packagingUnitName !== 'Piece' ? `(${rounding.packagesCount} ${packagingUnitName}s)` : 'units'}.`
                };
                const suggestion = this.repo.saveSuggestion({
                    businessId,
                    branchId: loc.branch_id,
                    productId: prod.id,
                    stockLocationId: loc.id,
                    suggestedQuantityScaled,
                    currentAvailableScaled: availableScaled,
                    targetStockScaled,
                    calculationReason: reason
                });
                // Set computed urgency
                suggestion.urgency = replenishment_math_1.ReplenishmentMath.determineUrgency(availableScaled, rule.minimumStockScaled, effectiveReorderPointScaled);
                generated.push(suggestion);
            }
        }
        return generated;
    }
    /**
     * Lists generated replenishment suggestions with filtering.
     */
    listSuggestions(filter) {
        const list = this.repo.listSuggestions(filter);
        return list.map((s) => {
            const rule = this.repo.getReorderRule(s.productId, s.stockLocationId, filter.businessId);
            const minStock = rule ? rule.minimumStockScaled : 0;
            const rop = rule ? rule.reorderPointScaled : 0;
            s.urgency = replenishment_math_1.ReplenishmentMath.determineUrgency(s.currentAvailableScaled, minStock, rop);
            const prod = this.productRepo.findById(s.productId);
            const costPrice = prod?.costPrice || prod?.defaultCostMinor || 0;
            s.estimatedCostMinor = Math.round((s.suggestedQuantityScaled / 1000) * costPrice);
            return s;
        });
    }
    /**
     * Modifies suggested quantity for an open replenishment suggestion.
     */
    editSuggestionQuantity(suggestionId, newQuantityScaled) {
        if (newQuantityScaled <= 0) {
            throw new Error('Suggested replenishment quantity must be greater than zero.');
        }
        this.repo.updateSuggestionStatus(suggestionId, 'open', newQuantityScaled);
        return this.repo.findById(suggestionId);
    }
    /**
     * Dismisses a replenishment suggestion.
     */
    dismissSuggestion(suggestionId) {
        this.repo.updateSuggestionStatus(suggestionId, 'dismissed');
    }
    /**
     * Converts selected replenishment suggestions into a DRAFT Purchase Order.
     * Strictly creates a draft purchase order without posting purchases or inflating stock.
     */
    convertSuggestionsToDraftPo(dto, actorContext) {
        if (!dto.suggestionIds || dto.suggestionIds.length === 0) {
            throw new Error('Please select at least one replenishment suggestion to convert.');
        }
        const supplier = this.supplierRepo.findById(dto.supplierId);
        if (!supplier)
            throw new Error(`Supplier '${dto.supplierId}' not found.`);
        replenishment_rules_1.ReplenishmentRules.validateSupplierForConversion(supplier);
        const suggestions = [];
        for (const sId of dto.suggestionIds) {
            const s = this.repo.findById(sId);
            if (!s)
                throw new Error(`Suggestion '${sId}' not found.`);
            if (s.status !== 'open') {
                throw new Error(`Suggestion '${sId}' is in status '${s.status}' and cannot be converted.`);
            }
            suggestions.push(s);
        }
        const invoiceNumber = `PO-DRAFT-${Date.now().toString().slice(-6)}`;
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            // 1. Insert into purchase_orders as DRAFT
            let subtotal = 0;
            const poItemsToInsert = [];
            for (const sugg of suggestions) {
                const prod = this.productRepo.findById(sugg.productId);
                const costPrice = prod?.costPrice || prod?.defaultCostMinor || 0;
                const qty = sugg.suggestedQuantityScaled / 1000;
                const lineTotal = Math.round(qty * costPrice);
                subtotal += lineTotal;
                poItemsToInsert.push({
                    productId: sugg.productId,
                    unitName: 'Piece',
                    quantity: qty,
                    conversionFactor: 1,
                    unitCostPrice: costPrice,
                    sellingPrice: prod?.sellingPrice || prod?.retailPriceMinor || costPrice,
                    lineTotal
                });
            }
            const poResult = this.db.prepare(`
        INSERT INTO purchase_orders (
          supplier_id, invoice_number, subtotal, additional_cost,
          grand_total, amount_paid, status, notes, created_at
        ) VALUES (?, ?, ?, 0, ?, 0, 'DRAFT', ?, ?)
      `).run(supplier.id, invoiceNumber, subtotal, subtotal, dto.notes || `Replenishment conversion for ${suggestions.length} suggestion(s)`, now);
            const poId = Number(poResult.lastInsertRowid);
            const itemInsert = this.db.prepare(`
        INSERT INTO purchase_order_items (
          purchase_order_id, product_id, unit_name, quantity,
          conversion_factor, unit_cost_price, selling_price, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const it of poItemsToInsert) {
                itemInsert.run(poId, it.productId, it.unitName, it.quantity, it.conversionFactor, it.unitCostPrice, it.sellingPrice, it.lineTotal);
            }
            // 2. Mark suggestions converted
            for (const sugg of suggestions) {
                this.repo.updateSuggestionStatus(sugg.id, 'converted');
            }
            return {
                purchaseOrderId: poId,
                purchaseOrderNumber: invoiceNumber,
                convertedSuggestionsCount: suggestions.length
            };
        });
        return tx();
    }
    /**
     * Generates real-time inventory alerts (out of stock, below minimum, below reorder point).
     * Prevents spamming duplicate alerts.
     */
    getStockAlerts(businessId, locationId) {
        const rules = this.repo.listReorderRules(businessId, locationId);
        const alerts = [];
        for (const rule of rules) {
            if (!rule.isActive)
                continue;
            const locId = rule.stockLocationId || locationId;
            if (!locId)
                continue;
            const bal = this.balanceRepo.getBalance(rule.productId, locId, businessId);
            const onHand = bal ? bal.onHandScaled : 0;
            const reserved = bal ? bal.reservedScaled : 0;
            const available = stock_reservation_rules_1.StockReservationRules.calculateAvailableStock(onHand, reserved);
            const prod = this.productRepo.findById(rule.productId);
            if (!prod || !prod.isActive)
                continue;
            const loc = this.locationRepo.findById(locId);
            if (available <= 0) {
                alerts.push({
                    id: `ALERT-OOS-${prod.id}-${locId}`,
                    type: 'OUT_OF_STOCK',
                    productId: prod.id,
                    productName: prod.name,
                    sku: prod.sku,
                    locationId: locId,
                    locationName: loc?.name || locId,
                    currentStock: onHand / 1000,
                    availableStock: available / 1000,
                    threshold: 0,
                    message: `Product "${prod.name}" is completely OUT OF STOCK at "${loc?.name || locId}". Available: 0.`,
                    createdAt: new Date().toISOString()
                });
            }
            else if (rule.minimumStockScaled > 0 && available < rule.minimumStockScaled) {
                alerts.push({
                    id: `ALERT-MIN-${prod.id}-${locId}`,
                    type: 'BELOW_MINIMUM',
                    productId: prod.id,
                    productName: prod.name,
                    sku: prod.sku,
                    locationId: locId,
                    locationName: loc?.name || locId,
                    currentStock: onHand / 1000,
                    availableStock: available / 1000,
                    threshold: rule.minimumStockScaled / 1000,
                    message: `Product "${prod.name}" is below minimum stock (${available / 1000} < ${rule.minimumStockScaled / 1000}) at "${loc?.name || locId}".`,
                    createdAt: new Date().toISOString()
                });
            }
            else if (rule.reorderPointScaled > 0 && available <= rule.reorderPointScaled) {
                alerts.push({
                    id: `ALERT-ROP-${prod.id}-${locId}`,
                    type: 'BELOW_REORDER_POINT',
                    productId: prod.id,
                    productName: prod.name,
                    sku: prod.sku,
                    locationId: locId,
                    locationName: loc?.name || locId,
                    currentStock: onHand / 1000,
                    availableStock: available / 1000,
                    threshold: rule.reorderPointScaled / 1000,
                    message: `Product "${prod.name}" has reached reorder point (${available / 1000} <= ${rule.reorderPointScaled / 1000}) at "${loc?.name || locId}".`,
                    createdAt: new Date().toISOString()
                });
            }
        }
        return alerts;
    }
}
exports.StockReplenishmentService = StockReplenishmentService;
