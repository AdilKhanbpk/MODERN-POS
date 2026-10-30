"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodsReceiptService = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../../infrastructure/sqlite/connection");
const GoodsReceiptRepository_1 = require("../../infrastructure/sqlite/repositories/GoodsReceiptRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const PurchaseOrderRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseOrderRepository");
const BatchRepository_1 = require("../../infrastructure/sqlite/repositories/BatchRepository");
const BatchExpiryService_1 = require("./BatchExpiryService");
const SerialTrackingService_1 = require("./SerialTrackingService");
const goods_receipt_rules_1 = require("../../domain/receiving/goods-receipt-rules");
const goods_receipt_math_1 = require("../../domain/receiving/goods-receipt-math");
class GoodsReceiptService {
    db;
    grnRepo;
    productRepo;
    locationRepo;
    balanceRepo;
    supplierRepo;
    poRepo;
    batchRepo;
    batchService;
    serialService;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.grnRepo = new GoodsReceiptRepository_1.GoodsReceiptRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.supplierRepo = new SupplierRepository_1.SupplierRepository(this.db);
        this.poRepo = new PurchaseOrderRepository_1.PurchaseOrderRepository(this.db);
        this.batchRepo = new BatchRepository_1.BatchRepository(this.db);
        this.batchService = new BatchExpiryService_1.BatchExpiryService(this.db);
        this.serialService = new SerialTrackingService_1.SerialTrackingService(this.db);
    }
    // =========================================================================
    // 1. SETTINGS
    // =========================================================================
    getSettings(businessId) {
        return this.grnRepo.getSettings(businessId);
    }
    configureSettings(businessId, settings) {
        return this.grnRepo.upsertSettings({
            businessId,
            ...settings
        });
    }
    // =========================================================================
    // 2. CREATION & INSPECTION WORKFLOW
    // =========================================================================
    createReceipt(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || '00000000-0000-0000-0000-000000000002';
        // Idempotency check
        const idempotencyKey = input.idempotencyKey || `GRN-IDEMP-${Date.now()}-${(0, crypto_1.randomUUID)().substring(0, 8)}`;
        const existing = this.grnRepo.findByIdempotencyKey(businessId, idempotencyKey);
        if (existing) {
            return existing;
        }
        // Validate supplier
        const supplier = this.supplierRepo.findById(input.supplierId);
        if (!supplier) {
            throw new Error(`Supplier '${input.supplierId}' not found.`);
        }
        // Validate location
        const location = this.locationRepo.findById(input.stockLocationId, businessId);
        if (!location) {
            throw new Error(`Stock location '${input.stockLocationId}' not found.`);
        }
        // Settings
        const settings = this.grnRepo.getSettings(businessId);
        // Validate Purchase Order if linked
        let purchaseOrder = null;
        if (input.purchaseOrderId) {
            purchaseOrder = this.poRepo.findById(input.purchaseOrderId, businessId);
            if (!purchaseOrder) {
                throw new Error(`Purchase order '${input.purchaseOrderId}' not found.`);
            }
        }
        // Validate products map
        const productsMap = new Map();
        for (const l of input.lines) {
            const prod = this.productRepo.findById(l.productId);
            if (prod) {
                productsMap.set(String(l.productId), prod);
            }
        }
        // Validate domain rules
        goods_receipt_rules_1.GoodsReceiptRules.validateCreateReceipt({
            input,
            supplier,
            location,
            productsMap,
            settings,
            purchaseOrder
        });
        // Generate receipt number if not provided
        const receiptNumber = input.receiptNumber || this.generateReceiptNumber(businessId);
        // Process lines & calculate exact base quantities
        const calculatedLines = input.lines.map((l) => {
            const num = l.conversionNumerator || 1;
            const den = l.conversionDenominator || 1;
            const accepted = l.acceptedQuantityScaled !== undefined ? l.acceptedQuantityScaled : l.receivedQuantityScaled;
            const rejected = l.rejectedQuantityScaled || 0;
            const damaged = l.damagedQuantityScaled || 0;
            // Invariant check: Received = Accepted + Rejected + Damaged
            const recon = goods_receipt_math_1.GoodsReceiptMath.validateQuantityReconciliation({
                receivedScaled: l.receivedQuantityScaled,
                acceptedScaled: accepted,
                rejectedScaled: rejected,
                damagedScaled: damaged
            });
            if (!recon.isConsistent) {
                throw new Error(recon.errorMessage);
            }
            const amounts = goods_receipt_math_1.GoodsReceiptMath.calculateLineQuantitiesAndCost({
                receivedScaled: l.receivedQuantityScaled,
                acceptedScaled: accepted,
                rejectedScaled: rejected,
                damagedScaled: damaged,
                conversionNumerator: num,
                conversionDenominator: den,
                unitCostMinor: l.unitCostMinor
            });
            return {
                purchaseOrderLineId: l.purchaseOrderLineId || null,
                productId: String(l.productId),
                variantId: l.variantId ? String(l.variantId) : null,
                batchId: l.batchId || null,
                batchNumber: l.batchNumber || null,
                expiryDate: l.expiryDate || null,
                manufacturingDate: l.manufacturingDate || null,
                purchaseUnitId: String(l.purchaseUnitId),
                conversionNumerator: num,
                conversionDenominator: den,
                receivedQuantityScaled: l.receivedQuantityScaled,
                acceptedQuantityScaled: accepted,
                rejectedQuantityScaled: rejected,
                damagedQuantityScaled: damaged,
                baseAcceptedQuantityScaled: amounts.baseAcceptedScaled,
                baseDamagedQuantityScaled: amounts.baseDamagedScaled,
                baseRejectedQuantityScaled: amounts.baseRejectedScaled,
                unitCostMinor: l.unitCostMinor || null,
                discrepancyType: l.discrepancyType || null,
                discrepancyReason: l.discrepancyReason || null,
                notes: l.notes || null,
                serials: l.serials
            };
        });
        const initialStatus = input.status || (settings?.requireInspection ? 'pending_inspection' : 'draft');
        return this.grnRepo.create({
            businessId,
            branchId,
            purchaseOrderId: input.purchaseOrderId || null,
            supplierId: String(supplier.id),
            receiptNumber,
            supplierDeliveryNote: input.supplierDeliveryNote || null,
            receivedAt: input.receivedAt || new Date().toISOString(),
            stockLocationId: input.stockLocationId,
            status: initialStatus,
            notes: input.notes || null,
            receivedBy: String(actor.userId),
            approvedBy: null,
            approvedAt: null,
            postedBy: null,
            postedAt: null,
            idempotencyKey
        }, calculatedLines);
    }
    inspectReceipt(input, actor) {
        const receipt = this.grnRepo.findById(input.goodsReceiptId);
        if (!receipt)
            throw new goods_receipt_rules_1.GoodsReceiptNotFoundError(input.goodsReceiptId);
        if (receipt.status === 'posted' || receipt.status === 'cancelled') {
            throw new Error(`Cannot inspect goods receipt '${receipt.receiptNumber}' in status '${receipt.status}'.`);
        }
        const linesMap = new Map();
        for (const l of receipt.lines || []) {
            linesMap.set(l.id, l);
        }
        const updatedLines = input.lines.map((iLine) => {
            const line = linesMap.get(iLine.goodsReceiptLineId);
            if (!line) {
                throw new Error(`Receipt line '${iLine.goodsReceiptLineId}' not found.`);
            }
            // Invariant check: Received = Accepted + Rejected + Damaged
            const recon = goods_receipt_math_1.GoodsReceiptMath.validateQuantityReconciliation({
                receivedScaled: line.receivedQuantityScaled,
                acceptedScaled: iLine.acceptedQuantityScaled,
                rejectedScaled: iLine.rejectedQuantityScaled,
                damagedScaled: iLine.damagedQuantityScaled
            });
            if (!recon.isConsistent) {
                throw new Error(recon.errorMessage);
            }
            const amounts = goods_receipt_math_1.GoodsReceiptMath.calculateLineQuantitiesAndCost({
                receivedScaled: line.receivedQuantityScaled,
                acceptedScaled: iLine.acceptedQuantityScaled,
                rejectedScaled: iLine.rejectedQuantityScaled,
                damagedScaled: iLine.damagedQuantityScaled,
                conversionNumerator: line.conversionNumerator,
                conversionDenominator: line.conversionDenominator,
                unitCostMinor: line.unitCostMinor
            });
            return {
                goodsReceiptLineId: line.id,
                acceptedQuantityScaled: iLine.acceptedQuantityScaled,
                rejectedQuantityScaled: iLine.rejectedQuantityScaled,
                damagedQuantityScaled: iLine.damagedQuantityScaled,
                baseAcceptedQuantityScaled: amounts.baseAcceptedScaled,
                baseDamagedQuantityScaled: amounts.baseDamagedScaled,
                baseRejectedQuantityScaled: amounts.baseRejectedScaled,
                discrepancyType: iLine.discrepancyType || line.discrepancyType || null,
                discrepancyReason: iLine.discrepancyReason || line.discrepancyReason || null,
                notes: iLine.notes || line.notes || null,
                serials: iLine.serials
            };
        });
        this.grnRepo.updateLinesInspection(receipt.id, updatedLines);
        this.grnRepo.updateStatus(receipt.id, 'approved', {
            approvedBy: String(actor.userId),
            approvedAt: new Date().toISOString()
        });
        return this.grnRepo.findById(receipt.id);
    }
    approveReceipt(receiptId, actor) {
        const receipt = this.grnRepo.findById(receiptId);
        if (!receipt)
            throw new goods_receipt_rules_1.GoodsReceiptNotFoundError(receiptId);
        goods_receipt_rules_1.GoodsReceiptRules.validateApproval(receipt, actor);
        goods_receipt_rules_1.GoodsReceiptRules.validateStatusTransition(receipt.status, 'approved', receipt.receiptNumber);
        this.grnRepo.updateStatus(receipt.id, 'approved', {
            approvedBy: String(actor.userId),
            approvedAt: new Date().toISOString()
        });
        return this.grnRepo.findById(receipt.id);
    }
    // =========================================================================
    // 3. ATOMIC INVENTORY POSTING
    // =========================================================================
    postReceipt(input, actor) {
        const receipt = this.grnRepo.findById(input.goodsReceiptId);
        if (!receipt)
            throw new goods_receipt_rules_1.GoodsReceiptNotFoundError(input.goodsReceiptId);
        // IDEMPOTENT CHECK: If already posted, return immediately without modifying inventory!
        if (receipt.status === 'posted') {
            return receipt;
        }
        // Validate posting rules
        goods_receipt_rules_1.GoodsReceiptRules.validatePosting(receipt, actor);
        const settings = this.grnRepo.getSettings(receipt.businessId);
        // Resolve quarantine location
        let quarantineLocationId = input.quarantineLocationId || settings?.quarantineLocationId;
        if (!quarantineLocationId) {
            const qLoc = this.db.prepare(`
        SELECT id FROM stock_locations
        WHERE business_id = ? AND location_type IN ('quarantine', 'damaged') AND is_active = 1
        LIMIT 1
      `).get(receipt.businessId);
            quarantineLocationId = qLoc?.id;
        }
        const lines = receipt.lines || [];
        const now = new Date().toISOString();
        // Resolve createdBy safely (must reference valid user in users table or null)
        let createdBy = null;
        if (actor?.userId != null) {
            const userRow = this.db.prepare('SELECT id FROM users WHERE id = ?').get(String(actor.userId));
            if (userRow) {
                createdBy = String(actor.userId);
            }
        }
        const tx = this.db.transaction(() => {
            // -----------------------------------------------------------------------
            // A. PRE-VALIDATION PASS ACROSS ALL LINES
            // -----------------------------------------------------------------------
            for (const line of lines) {
                const prod = this.productRepo.findById(line.productId);
                if (!prod) {
                    throw new Error(`Product '${line.productId}' not found.`);
                }
                // Batch requirements check
                const batchSetting = this.db.prepare(`
          SELECT * FROM product_batch_settings WHERE business_id = ? AND product_id = ?
        `).get(receipt.businessId, String(line.productId));
                if (batchSetting?.requires_batch) {
                    if (!line.batchNumber) {
                        throw new goods_receipt_rules_1.BatchRequiredError(prod.name);
                    }
                }
                // Serial requirements check
                const serialSetting = this.db.prepare(`
          SELECT * FROM product_serial_settings WHERE business_id = ? AND product_id = ?
        `).get(receipt.businessId, String(line.productId));
                if (serialSetting?.serial_tracking_required) {
                    const serials = line.serials || [];
                    const requiredCount = line.receivedQuantityScaled / 1000;
                    if (serials.length !== requiredCount) {
                        throw new goods_receipt_rules_1.SerialCountMismatchError(prod.name, requiredCount, serials.length);
                    }
                }
                // Over-delivery check against PO line
                if (line.purchaseOrderLineId) {
                    const poLine = this.db.prepare(`
            SELECT * FROM purchase_order_lines WHERE id = ?
          `).get(line.purchaseOrderLineId);
                    if (poLine) {
                        const alreadyReceived = Number(poLine.received_quantity_scaled || 0);
                        const ordered = Number(poLine.ordered_quantity_scaled || 0);
                        const overCheck = goods_receipt_math_1.GoodsReceiptMath.evaluateOverDelivery({
                            orderedScaled: ordered,
                            alreadyReceivedScaled: alreadyReceived,
                            incomingScaled: line.receivedQuantityScaled,
                            policy: settings?.overDeliveryPolicy || 'reject',
                            tolerancePercent: settings?.overDeliveryTolerancePercent || 0,
                            hasManagerApproval: Boolean(input.managerApproved)
                        });
                        if (overCheck.isOverDelivery && !overCheck.isPermitted) {
                            throw new goods_receipt_rules_1.OverDeliveryError(overCheck.reason);
                        }
                    }
                }
            }
            // -----------------------------------------------------------------------
            // B. EXECUTE STOCK UPDATES, MOVEMENTS & LEDGERS
            // -----------------------------------------------------------------------
            for (const line of lines) {
                const prod = this.productRepo.findById(line.productId);
                // 1. BATCH TRACKING REGISTRATION
                let effectiveBatchId = line.batchId || null;
                const batchSetting = this.db.prepare(`
          SELECT * FROM product_batch_settings WHERE business_id = ? AND product_id = ?
        `).get(receipt.businessId, String(line.productId));
                if (batchSetting?.requires_batch && line.batchNumber) {
                    let batch = this.batchRepo.findByProductAndNumber(line.productId, line.batchNumber, receipt.businessId);
                    if (!batch) {
                        batch = this.batchRepo.createBatch({
                            businessId: receipt.businessId,
                            productId: line.productId,
                            batchNumber: line.batchNumber,
                            expiryDate: line.expiryDate || new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0],
                            manufacturingDate: line.manufacturingDate || undefined,
                            supplierId: receipt.supplierId,
                            purchaseDocumentLineId: line.id,
                            status: 'active',
                            costMinor: line.unitCostMinor || 0,
                            initialQuantityScaled: line.baseAcceptedQuantityScaled
                        });
                    }
                    effectiveBatchId = batch.id;
                    // Update batch stock balance
                    this.batchRepo.upsertBalanceDelta({
                        businessId: receipt.businessId,
                        batchId: batch.id,
                        stockLocationId: receipt.stockLocationId,
                        onHandDeltaScaled: line.baseAcceptedQuantityScaled,
                        reservedDeltaScaled: 0
                    });
                    // Link batch_id on goods_receipt_lines
                    this.db.prepare(`
            UPDATE goods_receipt_lines SET batch_id = ? WHERE id = ?
          `).run(batch.id, line.id);
                }
                // 2. ACCEPTED QUANTITY -> Post to destination sellable stock location
                if (line.baseAcceptedQuantityScaled > 0) {
                    const acceptedUnits = line.baseAcceptedQuantityScaled / 1000;
                    // Increment location stock balance
                    this.balanceRepo.upsertDelta({
                        businessId: receipt.businessId,
                        productId: line.productId,
                        variantId: line.variantId || undefined,
                        stockLocationId: receipt.stockLocationId,
                        onHandDeltaScaled: line.baseAcceptedQuantityScaled
                    });
                    // Increment product currentStock
                    this.productRepo.updateStock(prod.id, prod.currentStock + acceptedUnits);
                    // Log authoritative movement in stock_movements
                    const movementId = (0, crypto_1.randomUUID)();
                    this.db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id,
              stock_location_id, batch_id, movement_type, direction,
              quantity_scaled, base_unit_id, unit_precision, unit_cost_minor,
              total_cost_minor, currency_code, reference_type, reference_id,
              reference_line_id, idempotency_key, occurred_at, posted_at, created_by
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, 'goods_receipt', 'IN',
              ?, ?, ?, ?,
              ?, 'PKR', 'goods_receipt', ?,
              ?, ?, ?, ?, ?
            )
          `).run(movementId, receipt.businessId, receipt.branchId, line.productId, line.variantId || null, receipt.stockLocationId, effectiveBatchId, line.baseAcceptedQuantityScaled, line.purchaseUnitId, 3, line.unitCostMinor || 0, Math.round((line.baseAcceptedQuantityScaled / 1000) * (line.unitCostMinor || 0)), receipt.id, line.id, `GRN-MOV-${receipt.id}-${line.id}-acc`, receipt.receivedAt, now, createdBy);
                    // Create FIFO inventory cost layer
                    if (line.unitCostMinor && line.unitCostMinor > 0) {
                        this.db.prepare(`
              INSERT INTO inventory_cost_layers (
                id, business_id, product_id, variant_id, stock_location_id,
                source_movement_id, received_quantity_scaled, remaining_quantity_scaled,
                unit_cost_minor, currency_code, received_at, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?)
            `).run((0, crypto_1.randomUUID)(), receipt.businessId, line.productId, line.variantId || null, receipt.stockLocationId, movementId, line.baseAcceptedQuantityScaled, line.baseAcceptedQuantityScaled, line.unitCostMinor, receipt.receivedAt, now);
                    }
                }
                // 3. DAMAGED QUANTITY -> Move to quarantine location if available
                if (line.baseDamagedQuantityScaled > 0 && quarantineLocationId) {
                    this.balanceRepo.upsertDelta({
                        businessId: receipt.businessId,
                        productId: line.productId,
                        variantId: line.variantId || undefined,
                        stockLocationId: quarantineLocationId,
                        onHandDeltaScaled: line.baseDamagedQuantityScaled
                    });
                    this.db.prepare(`
            INSERT INTO stock_movements (
              id, business_id, branch_id, product_id, variant_id,
              stock_location_id, batch_id, movement_type, direction,
              quantity_scaled, base_unit_id, unit_precision, unit_cost_minor,
              total_cost_minor, currency_code, reference_type, reference_id,
              reference_line_id, idempotency_key, occurred_at, posted_at, created_by
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, 'goods_receipt_damaged', 'IN',
              ?, ?, ?, ?,
              ?, 'PKR', 'goods_receipt', ?,
              ?, ?, ?, ?, ?
            )
          `).run((0, crypto_1.randomUUID)(), receipt.businessId, receipt.branchId, line.productId, line.variantId || null, quarantineLocationId, effectiveBatchId, line.baseDamagedQuantityScaled, line.purchaseUnitId, 3, line.unitCostMinor || 0, Math.round((line.baseDamagedQuantityScaled / 1000) * (line.unitCostMinor || 0)), receipt.id, line.id, `GRN-MOV-${receipt.id}-${line.id}-dmg`, receipt.receivedAt, now, createdBy);
                }
                // 4. SERIAL TRACKING INTEGRATION
                const serialSetting = this.db.prepare(`
          SELECT * FROM product_serial_settings WHERE business_id = ? AND product_id = ?
        `).get(receipt.businessId, String(line.productId));
                if (serialSetting?.serial_tracking_required) {
                    const serials = line.serials || [];
                    for (const s of serials) {
                        const serialStatus = s.condition === 'accepted' ? 'in_stock' : 'quarantined';
                        const serialLoc = s.condition === 'accepted' ? receipt.stockLocationId : (quarantineLocationId || receipt.stockLocationId);
                        this.serialService.receiveSerialUnits({
                            businessId: receipt.businessId,
                            productId: line.productId,
                            stockLocationId: serialLoc,
                            supplierId: receipt.supplierId,
                            purchaseDocumentLineId: line.id,
                            quantityScaled: 1000,
                            unitCostMinor: line.unitCostMinor || 0,
                            serials: [{
                                    serialNumber: s.serialNumber,
                                    manufacturerSerial: s.manufacturerSerial || undefined,
                                    imei1: s.imei1 || undefined,
                                    imei2: s.imei2 || undefined
                                }],
                            userId: actor.userId
                        });
                        // Update condition if not in_stock
                        if (serialStatus !== 'in_stock') {
                            this.db.prepare(`
                UPDATE product_serial_numbers
                SET status = ?, current_location_id = ?
                WHERE business_id = ? AND product_id = ? AND serial_number = ?
              `).run(serialStatus, serialLoc, receipt.businessId, String(line.productId), s.serialNumber);
                        }
                    }
                }
                // 5. PURCHASE ORDER LINE RECEIVING UPDATE
                if (line.purchaseOrderLineId) {
                    this.db.prepare(`
            UPDATE purchase_order_lines
            SET received_quantity_scaled = received_quantity_scaled + ?,
                updated_at = ?
            WHERE id = ?
          `).run(line.receivedQuantityScaled, now, line.purchaseOrderLineId);
                }
            }
            // 6. UPDATE OVERALL PURCHASE ORDER STATUS IF LINKED
            if (receipt.purchaseOrderId) {
                const poLines = this.poRepo.getLines(receipt.purchaseOrderId);
                const allReceived = poLines.every((l) => l.receivedQuantityScaled >= l.orderedQuantityScaled);
                const poStatus = allReceived ? 'fully_received' : 'partially_received';
                this.poRepo.updateStatus(receipt.purchaseOrderId, poStatus);
            }
            // 7. MARK RECEIPT AS POSTED
            this.grnRepo.updateStatus(receipt.id, 'posted', {
                postedBy: String(actor.userId),
                postedAt: now
            });
        });
        tx();
        return this.grnRepo.findById(receipt.id);
    }
    cancelReceipt(receiptId, reason, actor) {
        const receipt = this.grnRepo.findById(receiptId);
        if (!receipt)
            throw new goods_receipt_rules_1.GoodsReceiptNotFoundError(receiptId);
        if (receipt.status === 'posted') {
            throw new goods_receipt_rules_1.ReceiptAlreadyPostedError(receipt.receiptNumber);
        }
        goods_receipt_rules_1.GoodsReceiptRules.validateStatusTransition(receipt.status, 'cancelled', receipt.receiptNumber);
        this.grnRepo.updateStatus(receipt.id, 'cancelled');
        return this.grnRepo.findById(receipt.id);
    }
    // =========================================================================
    // 4. QUERIES & REPORTS
    // =========================================================================
    findById(id, businessId) {
        return this.grnRepo.findById(id, businessId);
    }
    findByReceiptNumber(businessId, receiptNumber) {
        return this.grnRepo.findByReceiptNumber(businessId, receiptNumber);
    }
    search(query) {
        return this.grnRepo.search(query);
    }
    getDiscrepancyReport(businessId, purchaseOrderId) {
        return this.grnRepo.getDiscrepancyReport(businessId, purchaseOrderId);
    }
    generateReceiptNumber(businessId) {
        const year = new Date().getFullYear();
        const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM goods_receipts WHERE business_id = ?
    `).get(businessId);
        const seq = (countRow?.count || 0) + 1;
        return `GRN-${year}-${String(seq).padStart(5, '0')}`;
    }
}
exports.GoodsReceiptService = GoodsReceiptService;
