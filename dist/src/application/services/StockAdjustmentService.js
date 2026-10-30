"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockAdjustmentService = void 0;
const StockAdjustmentRepository_1 = require("../../infrastructure/sqlite/repositories/StockAdjustmentRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const stock_adjustment_rules_1 = require("../../domain/inventory/stock-adjustment-rules");
const stocktake_rules_1 = require("../../domain/inventory/stocktake-rules");
const stock_reservation_rules_1 = require("../../domain/inventory/stock-reservation-rules");
const batch_expiry_rules_1 = require("../../domain/inventory/batch-expiry-rules");
const serial_rules_1 = require("../../domain/inventory/serial-rules");
const BatchRepository_1 = require("../../infrastructure/sqlite/repositories/BatchRepository");
class StockAdjustmentService {
    adjRepo;
    locationRepo;
    balanceRepo;
    productRepo;
    constructor(adjRepo = new StockAdjustmentRepository_1.StockAdjustmentRepository(), locationRepo = new StockLocationRepository_1.StockLocationRepository(), balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(), productRepo = new ProductRepository_1.ProductRepository()) {
        this.adjRepo = adjRepo;
        this.locationRepo = locationRepo;
        this.balanceRepo = balanceRepo;
        this.productRepo = productRepo;
    }
    getDb() {
        return this.adjRepo.getDb();
    }
    /**
     * Creates a draft or pending-approval stock adjustment.
     */
    createAdjustment(input, actor) {
        const db = this.getDb();
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || actor.branchId || '00000000-0000-0000-0000-000000000002';
        // 1. Idempotency Check
        if (input.idempotencyKey) {
            const existing = this.adjRepo.findByIdempotencyKey(businessId, input.idempotencyKey);
            if (existing) {
                return existing;
            }
        }
        // 2. Validate adjustment type and reason
        stock_adjustment_rules_1.StockAdjustmentRules.validateAdjustmentType(input.adjustmentType);
        stock_adjustment_rules_1.StockAdjustmentRules.validateReason(input.reasonCode, input.reasonDescription);
        // 3. Validate stock location
        const location = this.locationRepo.findById(input.stockLocationId);
        if (!location) {
            throw new Error(`Stock location '${input.stockLocationId}' not found`);
        }
        if (!location.isActive) {
            throw new Error(`Cannot perform stock adjustment in inactive/archived location '${location.name}'`);
        }
        if (location.businessId !== businessId) {
            throw new Error(`Cross-business access denied for location '${location.name}'`);
        }
        // Check if location is frozen by active stocktake (Prompt 14 Policy A)
        try {
            const frozenRow = db.prepare(`
        SELECT id, stocktake_number FROM stocktakes
        WHERE stock_location_id = ?
          AND freeze_stock = 1
          AND status IN ('in_progress', 'count_submitted', 'review', 'approved')
        LIMIT 1
      `).get(input.stockLocationId);
            if (frozenRow) {
                stocktake_rules_1.StocktakeRules.validateLocationFreeze(true, location.name, frozenRow.stocktake_number, Boolean(actor.overrideLocationFreeze), actor.role);
            }
        }
        catch (err) {
            if (err instanceof stocktake_rules_1.StockLocationFrozenError ||
                err?.name === 'StockLocationFrozenError' ||
                err instanceof stocktake_rules_1.StocktakeSecurityError ||
                err?.name === 'StocktakeSecurityError') {
                throw err;
            }
        }
        if (!input.lines || input.lines.length === 0) {
            throw new Error('Stock adjustment must contain at least one line item');
        }
        // 4. Resolve approval policy
        const policy = this.getApprovalPolicy(businessId);
        // 5. Build adjustment lines with system stock snapshot and difference calculation
        const linesToInsert = [];
        const adjustmentId = crypto.randomUUID();
        for (const lineInput of input.lines) {
            stock_adjustment_rules_1.StockAdjustmentRules.validatePhysicalCount(lineInput.countedQuantityScaled);
            const product = this.productRepo.findById(lineInput.productId);
            if (!product) {
                throw new Error(`Product '${lineInput.productId}' not found`);
            }
            if (!product.isActive) {
                throw new Error(`Cannot adjust stock for archived or inactive product '${product.name}'`);
            }
            // Fetch authoritative current balance for snapshot
            const bal = this.balanceRepo.getBalance(lineInput.productId, input.stockLocationId, businessId, lineInput.variantId);
            const systemQtyScaled = bal ? bal.onHandScaled : 0;
            const differenceQtyScaled = stock_adjustment_rules_1.StockAdjustmentRules.calculateDifference(lineInput.countedQuantityScaled, systemQtyScaled);
            const unitCostMinor = lineInput.unitCostMinor != null ? lineInput.unitCostMinor : (product.defaultCostMinor || product.costPrice || 0);
            const totalValueMinor = Math.round((differenceQtyScaled / 1000) * unitCostMinor);
            // Batch tracking bypass protection
            try {
                const batchSettings = db.prepare('SELECT requires_batch FROM product_batch_settings WHERE product_id = ?').get(String(product.id));
                if (batchSettings?.requires_batch && !lineInput.batchId) {
                    throw new batch_expiry_rules_1.BatchRequiredError(product.name);
                }
            }
            catch (err) {
                if (err instanceof batch_expiry_rules_1.BatchRequiredError || err?.name === 'BatchRequiredError')
                    throw err;
            }
            // Serial tracking bypass protection
            try {
                const serialSettings = db.prepare('SELECT serial_tracking_required FROM product_serial_settings WHERE product_id = ?').get(String(product.id));
                if (serialSettings?.serial_tracking_required && !lineInput.serialNumber && !lineInput.serialId) {
                    throw new serial_rules_1.SerialRequiredError(product.name);
                }
            }
            catch (err) {
                if (err instanceof serial_rules_1.SerialRequiredError || err?.name === 'SerialRequiredError')
                    throw err;
            }
            const unitId = lineInput.unitId
                ? String(lineInput.unitId)
                : (product.baseUnitId ? String(product.baseUnitId) : '00000000-0000-0000-0000-000000000001');
            linesToInsert.push({
                id: crypto.randomUUID(),
                adjustmentId,
                productId: String(product.id),
                productName: product.name,
                productSku: product.sku,
                variantId: lineInput.variantId ? String(lineInput.variantId) : null,
                batchId: lineInput.batchId ? String(lineInput.batchId) : null,
                systemQuantityScaled: systemQtyScaled,
                countedQuantityScaled: lineInput.countedQuantityScaled,
                differenceQuantityScaled: differenceQtyScaled,
                unitId,
                unitCostMinor,
                totalValueMinor,
                reason: lineInput.reason || null
            });
        }
        // 6. Evaluate approval requirements
        const approvalCheck = stock_adjustment_rules_1.StockAdjustmentRules.evaluateApprovalNeed(linesToInsert, input.adjustmentType, policy, actor.role);
        const adjustmentNumber = this.adjRepo.getNextAdjustmentNumber(businessId);
        const idempotencyKey = input.idempotencyKey || `adj-${adjustmentId}`;
        const now = new Date().toISOString();
        let initialStatus = 'draft';
        if (approvalCheck.requiresApproval) {
            initialStatus = 'pending_approval';
        }
        else if (input.autoPostIfPermitted) {
            initialStatus = 'approved';
        }
        const adjustment = {
            id: adjustmentId,
            businessId,
            branchId,
            adjustmentNumber,
            stockLocationId: input.stockLocationId,
            adjustmentType: input.adjustmentType,
            reasonCode: input.reasonCode,
            reasonDescription: input.reasonDescription,
            status: initialStatus,
            requestedBy: String(actor.userId),
            requestedAt: now,
            idempotencyKey,
            createdAt: now,
            updatedAt: now
        };
        const created = this.adjRepo.create(adjustment, linesToInsert);
        // If auto-post requested and permitted (within thresholds), post immediately
        if (input.autoPostIfPermitted && !approvalCheck.requiresApproval) {
            return this.postAdjustment(adjustmentId, actor);
        }
        return created;
    }
    /**
     * Submits a draft adjustment for approval.
     */
    submitForApproval(adjustmentId, actor) {
        const adj = this.adjRepo.findById(adjustmentId);
        if (!adj)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        stock_adjustment_rules_1.StockAdjustmentRules.validateStatusTransition(adj.status, 'pending_approval');
        this.adjRepo.updateStatus(adjustmentId, 'pending_approval');
        return this.adjRepo.findById(adjustmentId);
    }
    /**
     * Approves a pending adjustment. Enforces that requester cannot self-approve unless policy permits.
     */
    approveAdjustment(adjustmentId, actor) {
        const adj = this.adjRepo.findById(adjustmentId);
        if (!adj)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        stock_adjustment_rules_1.StockAdjustmentRules.validateStatusTransition(adj.status, 'approved');
        const policy = this.getApprovalPolicy(adj.businessId);
        stock_adjustment_rules_1.StockAdjustmentRules.validateApprovalActor(adj.requestedBy, String(actor.userId), actor.role, policy);
        const now = new Date().toISOString();
        this.adjRepo.updateStatus(adjustmentId, 'approved', {
            approvedBy: String(actor.userId),
            approvedAt: now
        });
        return this.adjRepo.findById(adjustmentId);
    }
    /**
     * Rejects a pending adjustment.
     */
    rejectAdjustment(adjustmentId, reason, actor) {
        const adj = this.adjRepo.findById(adjustmentId);
        if (!adj)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        stock_adjustment_rules_1.StockAdjustmentRules.validateStatusTransition(adj.status, 'rejected');
        const policy = this.getApprovalPolicy(adj.businessId);
        const isApprover = policy.approverRoles.map(r => r.toUpperCase()).includes(actor.role.toUpperCase());
        if (!isApprover) {
            throw new Error(`Role '${actor.role}' cannot reject adjustments`);
        }
        this.adjRepo.updateStatus(adjustmentId, 'rejected');
        return this.adjRepo.findById(adjustmentId);
    }
    /**
     * Cancels a draft, pending, or approved adjustment.
     */
    cancelAdjustment(adjustmentId, actor) {
        const adj = this.adjRepo.findById(adjustmentId);
        if (!adj)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        stock_adjustment_rules_1.StockAdjustmentRules.validateStatusTransition(adj.status, 'cancelled');
        this.adjRepo.updateStatus(adjustmentId, 'cancelled');
        return this.adjRepo.findById(adjustmentId);
    }
    /**
     * Posts an approved adjustment.
     * Performs stock drift detection, negative stock guard, creates immutable movements,
     * updates stock balance projection, and marks adjustment posted atomically.
     */
    postAdjustment(adjustmentId, actor, options = {}) {
        const adj = this.adjRepo.findById(adjustmentId);
        if (!adj)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        if (adj.status === 'posted') {
            throw new stock_adjustment_rules_1.AdjustmentAlreadyPostedError(adj.adjustmentNumber);
        }
        if (adj.status !== 'approved' && adj.status !== 'draft') {
            throw new Error(`Cannot post adjustment with status '${adj.status}'. Must be approved or draft.`);
        }
        // Revalidate location
        const location = this.locationRepo.findById(adj.stockLocationId);
        if (!location || !location.isActive) {
            throw new Error(`Cannot post to inactive or missing location '${adj.stockLocationId}'`);
        }
        const targetDb = this.getDb();
        return transaction_runner_1.TransactionRunner.run((db) => {
            // 1. Process each line: check drift, negative stock, and post movement
            for (const line of adj.lines) {
                const product = this.productRepo.findById(line.productId);
                if (!product || !product.isActive) {
                    throw new Error(`Product '${line.productId}' is inactive or deleted`);
                }
                const bal = this.balanceRepo.getBalance(line.productId, adj.stockLocationId, adj.businessId, line.variantId);
                const currentOnHandScaled = bal ? bal.onHandScaled : 0;
                // Drift Detection
                if (Math.round(currentOnHandScaled) !== Math.round(line.systemQuantityScaled)) {
                    if (options.forceRefreshSnapshot) {
                        // For count corrections, new difference brings stock to physical count.
                        // For damage/expiry/decrease, the fixed removal magnitude is retained.
                        const isFixedRemoval = (adj.adjustmentType === 'damage' || adj.adjustmentType === 'expiry' || adj.adjustmentType === 'decrease') && line.differenceQuantityScaled < 0;
                        const newDiffScaled = isFixedRemoval
                            ? line.differenceQuantityScaled
                            : stock_adjustment_rules_1.StockAdjustmentRules.calculateDifference(line.countedQuantityScaled, currentOnHandScaled);
                        const newTotalValueMinor = Math.round((newDiffScaled / 1000) * (line.unitCostMinor || product.defaultCostMinor || product.costPrice || 0));
                        this.adjRepo.updateLineSnapshot(line.id, currentOnHandScaled, newDiffScaled, newTotalValueMinor);
                        line.systemQuantityScaled = currentOnHandScaled;
                        line.differenceQuantityScaled = newDiffScaled;
                        line.totalValueMinor = newTotalValueMinor;
                    }
                    else {
                        stock_adjustment_rules_1.StockAdjustmentRules.validateStockDrift(product.name, line.systemQuantityScaled, currentOnHandScaled);
                    }
                }
                // Negative Stock Policy Check
                const allowNeg = Boolean(product.allow_negative_stock || product.allowNegativeStock);
                stock_adjustment_rules_1.StockAdjustmentRules.validateNegativeStock(product.name, currentOnHandScaled, line.differenceQuantityScaled, allowNeg);
                // Prompt 17 Reservation Conflict Guard:
                // If an adjustment causes on-hand quantity to drop below active reservations, require authorized override.
                const newOnHandScaled = currentOnHandScaled + line.differenceQuantityScaled;
                const activeReservedScaled = bal ? bal.reservedScaled : 0;
                stock_reservation_rules_1.StockReservationRules.validateAdjustmentReservationConflict(product.name, newOnHandScaled, activeReservedScaled, Boolean(options.allowReservationConflict));
                // 2. Post Movement if difference != 0
                if (line.differenceQuantityScaled !== 0) {
                    const isIncrease = line.differenceQuantityScaled > 0;
                    const absQuantityScaled = Math.abs(line.differenceQuantityScaled);
                    const direction = isIncrease ? 'IN' : 'OUT';
                    let movementType = isIncrease ? 'ADJUSTMENT_INCREASE' : 'ADJUSTMENT_DECREASE';
                    if (!isIncrease && adj.adjustmentType === 'damage') {
                        movementType = 'DAMAGE_WRITEOFF';
                    }
                    const movementId = crypto.randomUUID();
                    const idempotencyKey = `adj-mov-${adj.id}-${line.id}`;
                    const nowTime = new Date().toISOString();
                    // Insert into authoritative stock_movements
                    db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id, stock_location_id,
              batch_id, movement_type, direction, quantity_scaled, base_unit_id,
              unit_precision, unit_cost_minor, total_cost_minor, reference_type,
              reference_id, reference_line_id, idempotency_key, occurred_at,
              posted_at, created_by, created_at, location_id, quantity, previous_stock,
              new_stock, quantity_base_scaled, reason, user_id
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              3, ?, ?, 'ADJUSTMENT',
              ?, ?, ?, ?,
              ?, ?, ?, 1, ?, ?,
              ?, ?, ?, ?
            )
          `).run(movementId, adj.businessId, adj.branchId, line.productId, line.variantId || null, adj.stockLocationId, line.batchId || null, movementType, direction, absQuantityScaled, line.unitId, line.unitCostMinor || null, line.totalValueMinor != null ? Math.abs(line.totalValueMinor) : null, adj.id, line.id, idempotencyKey, nowTime, nowTime, String(actor.userId), nowTime, absQuantityScaled / 1000, currentOnHandScaled / 1000, (currentOnHandScaled + line.differenceQuantityScaled) / 1000, line.differenceQuantityScaled / 1000, adj.reasonDescription, Number(actor.userId) || 1);
                    // Update stock_balances projection delta
                    this.balanceRepo.upsertDelta({
                        businessId: adj.businessId,
                        productId: line.productId,
                        variantId: line.variantId,
                        stockLocationId: adj.stockLocationId,
                        onHandDeltaScaled: line.differenceQuantityScaled
                    });
                    // Update product cached stock
                    const newTotalStock = (currentOnHandScaled + line.differenceQuantityScaled) / 1000;
                    this.productRepo.updateStock(line.productId, newTotalStock);
                    // Update batch stock balance if batch-linked
                    if (line.batchId) {
                        try {
                            const batchRepo = new BatchRepository_1.BatchRepository(db);
                            batchRepo.upsertBalanceDelta({
                                businessId: adj.businessId,
                                batchId: line.batchId,
                                stockLocationId: adj.stockLocationId,
                                onHandDeltaScaled: line.differenceQuantityScaled,
                                reservedDeltaScaled: 0
                            });
                        }
                        catch {
                            // Safe fallback
                        }
                    }
                }
            }
            // 3. Mark adjustment posted
            const postedTime = new Date().toISOString();
            this.adjRepo.updateStatus(adjustmentId, 'posted', {
                postedBy: String(actor.userId),
                postedAt: postedTime
            });
            // 4. Record audit log
            try {
                db.prepare(`
          INSERT INTO audit_logs (
            business_id, user_id, action, entity_name, entity_id, payload, created_at
          ) VALUES (?, ?, 'POST_STOCK_ADJUSTMENT', 'stock_adjustments', ?, ?, ?)
        `).run(adj.businessId, String(actor.userId), adjustmentId, JSON.stringify({
                    adjustmentNumber: adj.adjustmentNumber,
                    type: adj.adjustmentType,
                    reasonCode: adj.reasonCode,
                    linesCount: adj.lines.length
                }), postedTime);
            }
            catch {
                // Fallback for legacy audit_logs schema
            }
            return this.adjRepo.findById(adjustmentId);
        }, targetDb);
    }
    /**
     * Reverses a posted adjustment by creating and posting an opposite compensating adjustment.
     */
    reverseAdjustment(adjustmentId, reason, actor) {
        const original = this.adjRepo.findById(adjustmentId);
        if (!original)
            throw new Error(`Stock adjustment '${adjustmentId}' not found`);
        if (original.status !== 'posted') {
            throw new Error(`Only posted adjustments can be reversed. Current status: '${original.status}'`);
        }
        const businessId = original.businessId;
        const branchId = original.branchId;
        const reversalId = crypto.randomUUID();
        const reversalNumber = this.adjRepo.getNextAdjustmentNumber(businessId);
        const now = new Date().toISOString();
        // Prepare reversing lines: Counted quantity is set to reverse the original difference
        const reversalLines = [];
        for (const line of original.lines) {
            const bal = this.balanceRepo.getBalance(line.productId, original.stockLocationId, businessId, line.variantId);
            const currentSystemScaled = bal ? bal.onHandScaled : 0;
            // Reverse original difference:
            // If original diff was -7000 (decrease), reversal diff must be +7000 (increase)
            const targetDifference = -line.differenceQuantityScaled;
            const targetCounted = currentSystemScaled + targetDifference;
            reversalLines.push({
                id: crypto.randomUUID(),
                adjustmentId: reversalId,
                productId: line.productId,
                productName: line.productName,
                productSku: line.productSku,
                variantId: line.variantId,
                batchId: line.batchId,
                systemQuantityScaled: currentSystemScaled,
                countedQuantityScaled: targetCounted,
                differenceQuantityScaled: targetDifference,
                unitId: line.unitId,
                unitCostMinor: line.unitCostMinor,
                totalValueMinor: line.totalValueMinor ? -line.totalValueMinor : null,
                reason: `Reversal of line ${line.id}`
            });
        }
        const reversalAdj = {
            id: reversalId,
            businessId,
            branchId,
            adjustmentNumber: reversalNumber,
            stockLocationId: original.stockLocationId,
            adjustmentType: 'correction',
            reasonCode: 'DATA_CORRECTION',
            reasonDescription: `Reversal of ${original.adjustmentNumber}: ${reason}`,
            status: 'approved',
            requestedBy: String(actor.userId),
            approvedBy: String(actor.userId),
            requestedAt: now,
            approvedAt: now,
            idempotencyKey: `rev-${original.id}-${reversalId}`,
            reversalOfId: original.id,
            createdAt: now,
            updatedAt: now
        };
        this.adjRepo.create(reversalAdj, reversalLines);
        return this.postAdjustment(reversalId, actor);
    }
    /**
     * Relocates usable stock into a damaged / quarantine location.
     * Total branch inventory is preserved, but ordinary POS checkout is prevented from selling it.
     */
    relocateToDamaged(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || actor.branchId || '00000000-0000-0000-0000-000000000002';
        const sourceLoc = this.locationRepo.findById(input.fromLocationId);
        if (!sourceLoc || !sourceLoc.isActive) {
            throw new Error(`Source location '${input.fromLocationId}' is invalid or inactive`);
        }
        const destLoc = this.locationRepo.findById(input.toDamagedLocationId);
        if (!destLoc || !destLoc.isActive) {
            throw new Error(`Destination damaged location '${input.toDamagedLocationId}' is invalid or inactive`);
        }
        // Verify destination is marked damaged/quarantine or non-sellable
        if (destLoc.isSellable && destLoc.locationType !== 'damaged' && destLoc.locationType !== 'quarantine') {
            throw new Error(`Destination location '${destLoc.name}' is sellable. Relocate to damaged requires a damaged/quarantine location.`);
        }
        const product = this.productRepo.findById(input.productId);
        if (!product || !product.isActive) {
            throw new Error(`Product '${input.productId}' is invalid or inactive`);
        }
        // Availability check at source location
        const sourceBal = this.balanceRepo.getBalance(input.productId, sourceLoc.id, businessId, input.variantId);
        const availableAtSource = sourceBal ? sourceBal.availableScaled : 0;
        if (availableAtSource < input.quantityScaled) {
            throw new Error(`Insufficient stock in location '${sourceLoc.name}'. Available: ${availableAtSource / 1000}, Required: ${input.quantityScaled / 1000}`);
        }
        const transferId = crypto.randomUUID();
        const outMovementId = crypto.randomUUID();
        const inMovementId = crypto.randomUUID();
        const now = new Date().toISOString();
        const unitId = product.baseUnitId ? String(product.baseUnitId) : '00000000-0000-0000-0000-000000000001';
        const targetDb = this.getDb();
        return transaction_runner_1.TransactionRunner.run((db) => {
            // 1. Transfer Out of source location
            db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, variant_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at,
          created_by, created_at, location_id, quantity, previous_stock, new_stock,
          quantity_base_scaled, reason, user_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'TRANSFER_OUT', 'OUT', ?, ?, 3,
          'TRANSFER', ?, ?, ?, ?,
          ?, ?, 1, ?, ?, ?,
          ?, ?, ?
        )
      `).run(outMovementId, businessId, branchId, String(product.id), input.variantId ? String(input.variantId) : null, sourceLoc.id, input.quantityScaled, unitId, transferId, `reloc-out-${transferId}`, now, now, String(actor.userId), now, input.quantityScaled / 1000, sourceBal ? sourceBal.onHandScaled / 1000 : 0, sourceBal ? (sourceBal.onHandScaled - input.quantityScaled) / 1000 : 0, -input.quantityScaled / 1000, `Relocate to damaged: ${input.reasonDescription}`, Number(actor.userId) || 1);
            this.balanceRepo.upsertDelta({
                businessId,
                productId: product.id,
                variantId: input.variantId,
                stockLocationId: sourceLoc.id,
                onHandDeltaScaled: -input.quantityScaled
            });
            // 2. Transfer In to damaged location
            const destBal = this.balanceRepo.getBalance(input.productId, destLoc.id, businessId, input.variantId);
            db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, variant_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at,
          created_by, created_at, location_id, quantity, previous_stock, new_stock,
          quantity_base_scaled, reason, user_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'TRANSFER_IN', 'IN', ?, ?, 3,
          'TRANSFER', ?, ?, ?, ?,
          ?, ?, 1, ?, ?, ?,
          ?, ?, ?
        )
      `).run(inMovementId, businessId, branchId, String(product.id), input.variantId ? String(input.variantId) : null, destLoc.id, input.quantityScaled, unitId, transferId, `reloc-in-${transferId}`, now, now, String(actor.userId), now, input.quantityScaled / 1000, destBal ? destBal.onHandScaled / 1000 : 0, destBal ? (destBal.onHandScaled + input.quantityScaled) / 1000 : 0, input.quantityScaled / 1000, `Received damaged stock: ${input.reasonDescription}`, Number(actor.userId) || 1);
            this.balanceRepo.upsertDelta({
                businessId,
                productId: product.id,
                variantId: input.variantId,
                stockLocationId: destLoc.id,
                onHandDeltaScaled: input.quantityScaled
            });
            return {
                transferOutMovementId: outMovementId,
                transferInMovementId: inMovementId,
                productId: String(product.id),
                fromLocationId: sourceLoc.id,
                toLocationId: destLoc.id,
                quantityScaled: input.quantityScaled
            };
        }, targetDb);
    }
    /**
     * Writes off stock completely (scrapping / destroying damaged or expired inventory).
     */
    writeOffDamaged(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || actor.branchId || '00000000-0000-0000-0000-000000000002';
        const location = this.locationRepo.findById(input.stockLocationId);
        if (!location || !location.isActive) {
            throw new Error(`Location '${input.stockLocationId}' is invalid or inactive`);
        }
        const product = this.productRepo.findById(input.productId);
        if (!product || !product.isActive) {
            throw new Error(`Product '${input.productId}' is invalid or inactive`);
        }
        const currentBal = this.balanceRepo.getBalance(input.productId, location.id, businessId, input.variantId);
        const available = currentBal ? currentBal.availableScaled : 0;
        if (available < input.quantityScaled) {
            throw new Error(`Insufficient stock for write-off in '${location.name}'. Available: ${available / 1000}, Requested write-off: ${input.quantityScaled / 1000}`);
        }
        const movementId = crypto.randomUUID();
        const now = new Date().toISOString();
        const unitId = product.baseUnitId ? String(product.baseUnitId) : '00000000-0000-0000-0000-000000000001';
        const targetDb = this.getDb();
        return transaction_runner_1.TransactionRunner.run((db) => {
            db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, variant_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at,
          created_by, created_at, location_id, quantity, previous_stock, new_stock,
          quantity_base_scaled, reason, user_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'DAMAGE_WRITEOFF', 'OUT', ?, ?, 3,
          'WRITE_OFF', ?, ?, ?, ?,
          ?, ?, 1, ?, ?, ?,
          ?, ?, ?
        )
      `).run(movementId, businessId, branchId, String(product.id), input.variantId ? String(input.variantId) : null, location.id, input.quantityScaled, unitId, movementId, `writeoff-${movementId}`, now, now, String(actor.userId), now, input.quantityScaled / 1000, currentBal ? currentBal.onHandScaled / 1000 : 0, currentBal ? (currentBal.onHandScaled - input.quantityScaled) / 1000 : 0, -input.quantityScaled / 1000, `Write-off: ${input.reasonDescription}`, Number(actor.userId) || 1);
            this.balanceRepo.upsertDelta({
                businessId,
                productId: product.id,
                variantId: input.variantId,
                stockLocationId: location.id,
                onHandDeltaScaled: -input.quantityScaled
            });
            const remainingTotal = (product.currentStock || 0) - (input.quantityScaled / 1000);
            this.productRepo.updateStock(product.id, Math.max(0, remainingTotal));
            return {
                movementId,
                productId: String(product.id),
                stockLocationId: location.id,
                quantityScaled: input.quantityScaled,
                status: 'WRITTEN_OFF'
            };
        }, targetDb);
    }
    /**
     * Returns inspected items from damaged location back into sellable floor stock.
     */
    returnToSellable(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || actor.branchId || '00000000-0000-0000-0000-000000000002';
        const sourceDamagedLoc = this.locationRepo.findById(input.fromDamagedLocationId);
        if (!sourceDamagedLoc || !sourceDamagedLoc.isActive) {
            throw new Error(`Source location '${input.fromDamagedLocationId}' is invalid or inactive`);
        }
        const destSellableLoc = this.locationRepo.findById(input.toSellableLocationId);
        if (!destSellableLoc || !destSellableLoc.isActive) {
            throw new Error(`Destination location '${input.toSellableLocationId}' is invalid or inactive`);
        }
        if (!destSellableLoc.isSellable) {
            throw new Error(`Destination location '${destSellableLoc.name}' is not marked sellable`);
        }
        const product = this.productRepo.findById(input.productId);
        if (!product || !product.isActive) {
            throw new Error(`Product '${input.productId}' is invalid or inactive`);
        }
        // Availability check in damaged location
        const damagedBal = this.balanceRepo.getBalance(input.productId, sourceDamagedLoc.id, businessId, input.variantId);
        const available = damagedBal ? damagedBal.availableScaled : 0;
        if (available < input.quantityScaled) {
            throw new Error(`Insufficient damaged stock to return. Available: ${available / 1000}, Requested: ${input.quantityScaled / 1000}`);
        }
        const transferId = crypto.randomUUID();
        const outMovementId = crypto.randomUUID();
        const inMovementId = crypto.randomUUID();
        const now = new Date().toISOString();
        const unitId = product.baseUnitId ? String(product.baseUnitId) : '00000000-0000-0000-0000-000000000001';
        const targetDb = this.getDb();
        return transaction_runner_1.TransactionRunner.run((db) => {
            // 1. Transfer Out of damaged
            db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, variant_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at,
          created_by, created_at, location_id, quantity, previous_stock, new_stock,
          quantity_base_scaled, reason, user_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'TRANSFER_OUT', 'OUT', ?, ?, 3,
          'INSPECTION_RESTORE', ?, ?, ?, ?,
          ?, ?, 1, ?, ?, ?,
          ?, ?, ?
        )
      `).run(outMovementId, businessId, branchId, String(product.id), input.variantId ? String(input.variantId) : null, sourceDamagedLoc.id, input.quantityScaled, unitId, transferId, `return-out-${transferId}`, now, now, String(actor.userId), now, input.quantityScaled / 1000, damagedBal ? damagedBal.onHandScaled / 1000 : 0, damagedBal ? (damagedBal.onHandScaled - input.quantityScaled) / 1000 : 0, -input.quantityScaled / 1000, `Inspected and restored: ${input.reasonDescription}`, Number(actor.userId) || 1);
            this.balanceRepo.upsertDelta({
                businessId,
                productId: product.id,
                variantId: input.variantId,
                stockLocationId: sourceDamagedLoc.id,
                onHandDeltaScaled: -input.quantityScaled
            });
            // 2. Transfer In to sellable
            const sellableBal = this.balanceRepo.getBalance(input.productId, destSellableLoc.id, businessId, input.variantId);
            db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, variant_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at,
          created_by, created_at, location_id, quantity, previous_stock, new_stock,
          quantity_base_scaled, reason, user_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'TRANSFER_IN', 'IN', ?, ?, 3,
          'INSPECTION_RESTORE', ?, ?, ?, ?,
          ?, ?, 1, ?, ?, ?,
          ?, ?, ?
        )
      `).run(inMovementId, businessId, branchId, String(product.id), input.variantId ? String(input.variantId) : null, destSellableLoc.id, input.quantityScaled, unitId, transferId, `return-in-${transferId}`, now, now, String(actor.userId), now, input.quantityScaled / 1000, sellableBal ? sellableBal.onHandScaled / 1000 : 0, sellableBal ? (sellableBal.onHandScaled + input.quantityScaled) / 1000 : 0, input.quantityScaled / 1000, `Restored to sellable stock: ${input.reasonDescription}`, Number(actor.userId) || 1);
            this.balanceRepo.upsertDelta({
                businessId,
                productId: product.id,
                variantId: input.variantId,
                stockLocationId: destSellableLoc.id,
                onHandDeltaScaled: input.quantityScaled
            });
            return {
                transferOutMovementId: outMovementId,
                transferInMovementId: inMovementId,
                productId: String(product.id),
                fromLocationId: sourceDamagedLoc.id,
                toLocationId: destSellableLoc.id,
                quantityScaled: input.quantityScaled
            };
        }, targetDb);
    }
    listAdjustments(filters) {
        return this.adjRepo.list(filters);
    }
    getAdjustmentById(id) {
        return this.adjRepo.findById(id);
    }
    getApprovalPolicy(businessId) {
        const policy = this.adjRepo.getPolicy(businessId);
        if (policy)
            return policy;
        const defaultPolicy = {
            id: crypto.randomUUID(),
            businessId,
            maxAutoApproveQtyScaled: 5000,
            maxAutoApproveValueMinor: 500000,
            requireApprovalForTypes: ['damage', 'expiry', 'other'],
            allowSelfApproval: false,
            approverRoles: ['OWNER', 'ADMINISTRATOR', 'MANAGER']
        };
        this.adjRepo.upsertPolicy(defaultPolicy);
        return defaultPolicy;
    }
    updateApprovalPolicy(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const current = this.getApprovalPolicy(businessId);
        const updated = {
            ...current,
            maxAutoApproveQtyScaled: input.maxAutoApproveQtyScaled !== undefined ? input.maxAutoApproveQtyScaled : current.maxAutoApproveQtyScaled,
            maxAutoApproveValueMinor: input.maxAutoApproveValueMinor !== undefined ? input.maxAutoApproveValueMinor : current.maxAutoApproveValueMinor,
            requireApprovalForTypes: input.requireApprovalForTypes !== undefined ? input.requireApprovalForTypes : current.requireApprovalForTypes,
            allowSelfApproval: input.allowSelfApproval !== undefined ? input.allowSelfApproval : current.allowSelfApproval,
            approverRoles: input.approverRoles !== undefined ? input.approverRoles : current.approverRoles
        };
        this.adjRepo.upsertPolicy(updated);
        return updated;
    }
}
exports.StockAdjustmentService = StockAdjustmentService;
