"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchExpiryService = void 0;
const connection_1 = require("../../infrastructure/sqlite/connection");
const BatchRepository_1 = require("../../infrastructure/sqlite/repositories/BatchRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const batch_expiry_math_1 = require("../../domain/inventory/batch-expiry-math");
const batch_expiry_rules_1 = require("../../domain/inventory/batch-expiry-rules");
const types_1 = require("../../shared/types");
class BatchExpiryService {
    db;
    repo;
    balanceRepo;
    productRepo;
    locationRepo;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.repo = new BatchRepository_1.BatchRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
    }
    // =========================================================================
    // 1. SETTINGS CONFIGURATION
    // =========================================================================
    configureBatchSettings(dto) {
        const prod = this.productRepo.findById(dto.productId);
        if (!prod) {
            throw new Error(`Product ID "${dto.productId}" not found.`);
        }
        return this.repo.upsertSettings(dto);
    }
    getBatchSettings(productId, businessId) {
        return this.repo.getSettings(productId, businessId);
    }
    // =========================================================================
    // 2. BATCH RECEIPT WORKFLOW
    // =========================================================================
    receiveBatch(dto, actor = {}) {
        const prod = this.productRepo.findById(dto.productId);
        if (!prod)
            throw new Error(`Product ID "${dto.productId}" not found.`);
        const settings = this.repo.getSettings(dto.productId, dto.businessId);
        // Validate receipt data against settings
        batch_expiry_rules_1.BatchExpiryRules.validateBatchReceipt(dto, settings);
        // Validate duplicate batch number for this product
        const existing = this.repo.findByProductAndNumber(dto.productId, dto.batchNumber, dto.businessId);
        if (existing) {
            throw new batch_expiry_rules_1.DuplicateBatchNumberError(dto.batchNumber, prod.name);
        }
        const tx = this.db.transaction(() => {
            // 1. Create product_batches row
            const batch = this.repo.createBatch({
                businessId: dto.businessId,
                productId: dto.productId,
                batchNumber: dto.batchNumber,
                manufacturingDate: dto.manufacturingDate,
                expiryDate: dto.expiryDate,
                supplierId: dto.supplierId,
                purchaseDocumentLineId: dto.purchaseDocumentLineId,
                status: 'active',
                costMinor: dto.unitCostMinor,
                initialQuantityScaled: dto.quantityScaled,
                notes: dto.notes
            });
            // 2. Update batch_stock_balances
            const batchBal = this.repo.upsertBalanceDelta({
                businessId: dto.businessId,
                batchId: batch.id,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // 3. Update stock_balances for location & product
            this.balanceRepo.upsertDelta({
                businessId: dto.businessId,
                productId: dto.productId,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // 4. Update products.current_stock
            const qtyUnits = dto.quantityScaled / 1000;
            const newStock = prod.currentStock + qtyUnits;
            this.productRepo.updateStock(prod.id, newStock);
            // 5. Log immutable stock movement
            this.productRepo.logStockMovement({
                productId: prod.id,
                movementType: types_1.StockMovementType.PURCHASE_RECEIPT,
                quantity: qtyUnits,
                previousStock: prod.currentStock,
                newStock,
                stockLocationId: dto.stockLocationId,
                referenceType: 'PURCHASE_BATCH',
                reason: `Batch receipt #${batch.batchNumber}`,
                userId: actor.userId ? Number(actor.userId) : 1
            });
            // Update movement ledger with batch_id
            try {
                this.db.prepare(`
          UPDATE stock_movements
          SET batch_id = ?
          WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)
        `).run(batch.id, prod.id);
            }
            catch {
                // Safe fallback
            }
            return { batch, balance: batchBal };
        });
        return tx();
    }
    // =========================================================================
    // 3. FEFO SELECTION & ALLOCATION WORKFLOW
    // =========================================================================
    allocateBatchesForSale(params) {
        const { businessId, productId, stockLocationId, requestedQuantityScaled, preferredBatchId, isAuthorized, referenceDate } = params;
        const prod = this.productRepo.findById(productId);
        if (!prod)
            throw new Error(`Product "${productId}" not found.`);
        const settings = this.repo.getSettings(productId, businessId);
        // Case A: User explicitly requested a specific batch
        if (preferredBatchId) {
            const batch = this.repo.findById(preferredBatchId);
            if (!batch)
                throw new batch_expiry_rules_1.BatchNotFoundError(preferredBatchId);
            // Validate eligibility against policy
            batch_expiry_rules_1.BatchExpiryRules.validateSaleBatchEligibility(batch, settings, referenceDate, isAuthorized);
            const bal = this.repo.getBatchBalance(preferredBatchId, stockLocationId, businessId);
            const available = bal ? bal.availableScaled || 0 : 0;
            if (available < requestedQuantityScaled) {
                throw new batch_expiry_rules_1.InsufficientBatchStockError(batch.batchNumber, requestedQuantityScaled / 1000, available / 1000);
            }
            return [
                {
                    batchId: batch.id,
                    batchNumber: batch.batchNumber,
                    expiryDate: batch.expiryDate,
                    quantityScaled: requestedQuantityScaled,
                    unitCostMinor: batch.costMinor
                }
            ];
        }
        // Case B: FEFO Automated Selection
        const eligibleCandidates = this.repo.getFefoEligibleBatches(productId, stockLocationId, businessId);
        if (eligibleCandidates.length === 0) {
            throw new batch_expiry_rules_1.BatchRequiredError(prod.name);
        }
        // Filter candidate batches through expiry sale eligibility
        let lastPolicyError = null;
        const validCandidates = eligibleCandidates.filter((cand) => {
            try {
                const batch = this.repo.findById(cand.id);
                if (!batch)
                    return false;
                const result = batch_expiry_rules_1.BatchExpiryRules.validateSaleBatchEligibility(batch, settings, referenceDate, isAuthorized);
                return result.isAllowed;
            }
            catch (err) {
                lastPolicyError = err;
                return false;
            }
        });
        const fefoResult = batch_expiry_math_1.BatchExpiryMath.allocateFefoBatches(validCandidates, requestedQuantityScaled);
        if (!fefoResult.isFullyAllocated) {
            if (lastPolicyError && validCandidates.length === 0) {
                throw lastPolicyError;
            }
            const totalAvailable = validCandidates.reduce((sum, c) => sum + c.availableScaled, 0);
            throw new batch_expiry_rules_1.InsufficientBatchStockError('All FEFO Batches', requestedQuantityScaled / 1000, totalAvailable / 1000);
        }
        return fefoResult.allocations;
    }
    // =========================================================================
    // 4. RETURNS, RECALLS & QUARANTINE
    // =========================================================================
    customerReturnBatch(dto, actor = {}) {
        const batch = this.repo.findById(dto.batchId);
        if (!batch)
            throw new batch_expiry_rules_1.BatchNotFoundError(dto.batchId);
        const prod = this.productRepo.findById(batch.productId);
        if (!prod)
            throw new Error(`Product "${batch.productId}" not found.`);
        const tx = this.db.transaction(() => {
            let targetStatus = batch.status;
            // Medicine or food returns: if returnToQuarantine is set, mark batch quarantine
            if (dto.returnToQuarantine) {
                targetStatus = 'quarantine';
                this.repo.updateStatus(batch.id, 'quarantine', `Customer return quarantined: ${dto.reason}`);
            }
            // Update batch stock balance
            this.repo.upsertBalanceDelta({
                businessId: dto.businessId,
                batchId: batch.id,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // Update location stock balance
            this.balanceRepo.upsertDelta({
                businessId: dto.businessId,
                productId: batch.productId,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // Update product current stock
            const qtyUnits = dto.quantityScaled / 1000;
            const newStock = prod.currentStock + qtyUnits;
            this.productRepo.updateStock(prod.id, newStock);
            // Log movement
            this.productRepo.logStockMovement({
                productId: prod.id,
                movementType: types_1.StockMovementType.SALE_RETURN,
                quantity: qtyUnits,
                previousStock: prod.currentStock,
                newStock,
                stockLocationId: dto.stockLocationId,
                referenceType: 'RETURN_BATCH',
                referenceId: dto.referenceId ? Number(dto.referenceId) : undefined,
                reason: dto.reason,
                userId: actor.userId ? Number(actor.userId) : 1
            });
            return { success: true, newStatus: targetStatus };
        });
        return tx();
    }
    recallBatch(dto, actor = {}) {
        const batch = this.repo.findById(dto.batchId);
        if (!batch)
            throw new batch_expiry_rules_1.BatchNotFoundError(dto.batchId);
        const tx = this.db.transaction(() => {
            // 1. Immediately update status to 'recalled'
            this.repo.updateStatus(dto.batchId, 'recalled', `RECALLED: ${dto.reason}`);
            // 2. Fetch all sales that included this batch
            const affectedSales = this.repo.getSalesForBatch(dto.batchId);
            // 3. Calculate remaining physical on-hand stock
            const balances = this.db.prepare(`
        SELECT SUM(on_hand_scaled) as total_on_hand
        FROM batch_stock_balances
        WHERE batch_id = ?
      `).get(dto.batchId);
            const remainingScaled = Number(balances?.total_on_hand) || 0;
            return {
                affectedSales,
                remainingStockUnits: remainingScaled / 1000
            };
        });
        return tx();
    }
    releaseQuarantineBatch(batchId, actor = {}) {
        const batch = this.repo.findById(batchId);
        if (!batch)
            throw new batch_expiry_rules_1.BatchNotFoundError(batchId);
        if (batch.status !== 'quarantine') {
            throw new Error(`Batch "${batch.batchNumber}" is in status "${batch.status}", not "quarantine".`);
        }
        this.repo.updateStatus(batchId, 'active', 'Quarantine released after inspection approval.');
        return this.repo.findById(batchId);
    }
    writeOffBatch(dto, actor = {}) {
        const batch = this.repo.findById(dto.batchId);
        if (!batch)
            throw new batch_expiry_rules_1.BatchNotFoundError(dto.batchId);
        const prod = this.productRepo.findById(batch.productId);
        if (!prod)
            throw new Error(`Product "${batch.productId}" not found.`);
        const bal = this.repo.getBatchBalance(dto.batchId, dto.stockLocationId, dto.businessId);
        const currentOnHandScaled = bal ? bal.onHandScaled : 0;
        if (currentOnHandScaled < dto.quantityScaled) {
            throw new batch_expiry_rules_1.InsufficientBatchStockError(batch.batchNumber, dto.quantityScaled / 1000, currentOnHandScaled / 1000);
        }
        const tx = this.db.transaction(() => {
            // Deduct from batch balance
            this.repo.upsertBalanceDelta({
                businessId: dto.businessId,
                batchId: dto.batchId,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: -dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // Deduct from location balance
            this.balanceRepo.upsertDelta({
                businessId: dto.businessId,
                productId: batch.productId,
                stockLocationId: dto.stockLocationId,
                onHandDeltaScaled: -dto.quantityScaled,
                reservedDeltaScaled: 0
            });
            // Deduct from product stock
            const qtyUnits = dto.quantityScaled / 1000;
            const newStock = Math.max(0, prod.currentStock - qtyUnits);
            this.productRepo.updateStock(prod.id, newStock);
            // Check remaining stock across all locations; if 0, mark closed
            const totalRemaining = this.db.prepare(`
        SELECT SUM(on_hand_scaled) as rem FROM batch_stock_balances WHERE batch_id = ?
      `).get(dto.batchId);
            if (!totalRemaining || Number(totalRemaining.rem) <= 0) {
                this.repo.updateStatus(dto.batchId, 'closed', `Written off completely: ${dto.reasonDescription}`);
            }
            // Log movement
            this.productRepo.logStockMovement({
                productId: prod.id,
                movementType: types_1.StockMovementType.ADJUSTMENT_DAMAGE,
                quantity: qtyUnits,
                previousStock: prod.currentStock,
                newStock,
                stockLocationId: dto.stockLocationId,
                referenceType: 'BATCH_WRITEOFF',
                reason: `${dto.reasonCode}: ${dto.reasonDescription}`,
                userId: actor.userId ? Number(actor.userId) : 1
            });
        });
        tx();
    }
    // =========================================================================
    // 5. BATCH TRANSFER BETWEEN LOCATIONS
    // =========================================================================
    transferBatchStock(params, actor = {}) {
        const { businessId, batchId, sourceLocationId, destinationLocationId, quantityScaled } = params;
        const batch = this.repo.findById(batchId);
        if (!batch)
            throw new batch_expiry_rules_1.BatchNotFoundError(batchId);
        if (batch.status === 'recalled') {
            throw new batch_expiry_rules_1.BatchRecalledError(batch.batchNumber);
        }
        const sourceBal = this.repo.getBatchBalance(batchId, sourceLocationId, businessId);
        const sourceAvail = sourceBal ? sourceBal.availableScaled || 0 : 0;
        if (sourceAvail < quantityScaled) {
            throw new batch_expiry_rules_1.InsufficientBatchStockError(batch.batchNumber, quantityScaled / 1000, sourceAvail / 1000);
        }
        const tx = this.db.transaction(() => {
            // 1. Deduct from source batch balance
            this.repo.upsertBalanceDelta({
                businessId,
                batchId,
                stockLocationId: sourceLocationId,
                onHandDeltaScaled: -quantityScaled,
                reservedDeltaScaled: 0
            });
            // 2. Add to destination batch balance
            this.repo.upsertBalanceDelta({
                businessId,
                batchId,
                stockLocationId: destinationLocationId,
                onHandDeltaScaled: quantityScaled,
                reservedDeltaScaled: 0
            });
            // 3. Update stock_balances for both locations
            this.balanceRepo.upsertDelta({
                businessId,
                productId: batch.productId,
                stockLocationId: sourceLocationId,
                onHandDeltaScaled: -quantityScaled,
                reservedDeltaScaled: 0
            });
            this.balanceRepo.upsertDelta({
                businessId,
                productId: batch.productId,
                stockLocationId: destinationLocationId,
                onHandDeltaScaled: quantityScaled,
                reservedDeltaScaled: 0
            });
        });
        tx();
    }
    // =========================================================================
    // 6. REPORTS & TRACEABILITY
    // =========================================================================
    getBatchStockReport(businessId, locationId) {
        return this.repo.getBatchStockReport(businessId, locationId);
    }
    getExpiringSoonReport(businessId, daysThreshold = 30, locationId) {
        return this.repo.getExpiringSoonBatches(businessId, daysThreshold, locationId);
    }
    getExpiredStockReport(businessId, locationId) {
        return this.repo.getExpiredBatches(businessId, locationId);
    }
    getRecalledBatchReport(businessId) {
        return this.repo.getRecalledBatches(businessId);
    }
    getBatchValuationReport(businessId, locationId) {
        const items = this.repo.getBatchStockReport(businessId, locationId);
        const totalValuationMinor = items.reduce((sum, item) => sum + item.totalValuationMinor, 0);
        return { items, totalValuationMinor };
    }
    getBatchSalesTraceability(batchId) {
        return this.repo.getSalesForBatch(batchId);
    }
}
exports.BatchExpiryService = BatchExpiryService;
