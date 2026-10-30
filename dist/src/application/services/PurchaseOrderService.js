"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseOrderService = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../../infrastructure/sqlite/connection");
const PurchaseOrderRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseOrderRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const BatchExpiryService_1 = require("./BatchExpiryService");
const SerialTrackingService_1 = require("./SerialTrackingService");
const accounts_1 = require("../../shared/constants/accounts");
const purchase_order_rules_1 = require("../../domain/purchase/purchase-order-rules");
const purchase_order_math_1 = require("../../domain/purchase/purchase-order-math");
class PurchaseOrderService {
    db;
    poRepo;
    productRepo;
    locationRepo;
    balanceRepo;
    supplierRepo;
    batchService;
    serialService;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.poRepo = new PurchaseOrderRepository_1.PurchaseOrderRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.supplierRepo = new SupplierRepository_1.SupplierRepository(this.db);
        this.batchService = new BatchExpiryService_1.BatchExpiryService(this.db);
        this.serialService = new SerialTrackingService_1.SerialTrackingService(this.db);
    }
    // =========================================================================
    // 1. SETTINGS & METADATA
    // =========================================================================
    getSettings(businessId) {
        return this.poRepo.getSettings(businessId);
    }
    configureSettings(businessId, settings) {
        return this.poRepo.upsertSettings(businessId, settings);
    }
    getLastPurchasePrice(businessId, supplierId, productId) {
        return this.poRepo.getLastPurchasePrice(businessId, supplierId, productId);
    }
    // =========================================================================
    // 2. PURCHASE ORDER CREATION & PLANNING
    // =========================================================================
    createOrder(input, actor) {
        const businessId = input.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';
        const branchId = input.branchId || '00000000-0000-0000-0000-000000000002';
        // Idempotency check: if key already exists, return existing order without creating duplicate
        const idempotencyKey = input.idempotencyKey || `PO-IDEMP-${Date.now()}-${(0, crypto_1.randomUUID)().substring(0, 8)}`;
        const existingPo = this.poRepo.findByIdempotencyKey(businessId, idempotencyKey);
        if (existingPo) {
            return existingPo;
        }
        // Validate supplier
        const supplier = this.supplierRepo.findById(input.supplierId);
        if (!supplier) {
            throw new Error(`Supplier '${input.supplierId}' not found.`);
        }
        // Load products map
        const productsMap = new Map();
        for (const line of input.lines) {
            const prod = this.productRepo.findById(line.productId);
            if (prod) {
                productsMap.set(String(line.productId), prod);
            }
        }
        // Validate rules
        purchase_order_rules_1.PurchaseOrderRules.validateCreateOrder(input, supplier, productsMap);
        // Calculate line amounts with snapshot unit conversions
        const calculatedLines = input.lines.map((line) => {
            const num = line.conversionNumerator || 1;
            const den = line.conversionDenominator || 1;
            const amounts = purchase_order_math_1.PurchaseOrderMath.calculateLine({
                orderedQuantityScaled: line.orderedQuantityScaled,
                unitPriceMinor: line.unitPriceMinor,
                lineDiscountMinor: line.lineDiscountMinor || 0,
                taxRatePercent: line.taxRatePercent || 0,
                conversionNumerator: num,
                conversionDenominator: den
            });
            return {
                productId: String(line.productId),
                variantId: line.variantId ? String(line.variantId) : null,
                orderedQuantityScaled: line.orderedQuantityScaled,
                receivedQuantityScaled: 0,
                invoicedQuantityScaled: 0,
                purchaseUnitId: String(line.purchaseUnitId),
                conversionNumerator: num,
                conversionDenominator: den,
                baseQuantityScaled: amounts.baseQuantityScaled,
                unitPriceMinor: line.unitPriceMinor,
                lineDiscountMinor: line.lineDiscountMinor || 0,
                taxProfileId: line.taxProfileId || null,
                taxMinor: amounts.taxAmountMinor,
                taxAmountMinor: amounts.taxAmountMinor,
                lineTotalMinor: amounts.lineTotalMinor,
                notes: line.notes || null,
                grossLineAmountMinor: amounts.grossLineAmountMinor
            };
        });
        // Calculate document totals
        const totals = purchase_order_math_1.PurchaseOrderMath.calculateOrderTotals({
            lines: calculatedLines,
            documentDiscountMinor: input.discountMinor || 0,
            shippingMinor: input.shippingMinor || 0,
            otherChargesMinor: input.otherChargesMinor || 0
        });
        // Generate PO number if not provided
        const poNumber = input.purchaseOrderNumber || this.generatePoNumber(businessId);
        // Determine initial status & approval logic
        const settings = this.poRepo.getSettings(businessId);
        let initialStatus = 'draft';
        let approvedBy = null;
        let approvedAt = null;
        if (input.submitForApproval) {
            const threshold = settings?.requireApprovalAboveMinor ?? 10000000;
            if (totals.totalMinor <= threshold) {
                // Auto-approved under threshold
                initialStatus = 'approved';
                approvedBy = String(actor.userId);
                approvedAt = new Date().toISOString();
            }
            else {
                initialStatus = 'pending_approval';
            }
        }
        // Save order and lines atomically.
        // CRITICAL: DOES NOT touch inventory or create supplier payables!
        return this.poRepo.create({
            businessId,
            branchId,
            supplierId: String(supplier.id),
            purchaseOrderNumber: poNumber,
            orderDate: input.orderDate || new Date().toISOString(),
            expectedDeliveryDate: input.expectedDeliveryDate || null,
            currencyCode: input.currencyCode || 'PKR',
            exchangeRateNumerator: input.exchangeRateNumerator || 1,
            exchangeRateDenominator: input.exchangeRateDenominator || 1,
            subtotalMinor: totals.subtotalMinor,
            discountMinor: totals.discountMinor,
            taxMinor: totals.taxMinor,
            shippingMinor: totals.shippingMinor,
            otherChargesMinor: totals.otherChargesMinor,
            totalMinor: totals.totalMinor,
            status: initialStatus,
            paymentTermsDays: input.paymentTermsDays || 0,
            notes: input.notes || null,
            createdBy: String(actor.userId),
            approvedBy,
            approvedAt,
            sentAt: null,
            closedAt: null,
            idempotencyKey
        }, calculatedLines);
    }
    // =========================================================================
    // 3. WORKFLOW ACTIONS (SUBMIT, APPROVE, SEND, CANCEL, CLOSE)
    // =========================================================================
    submitForApproval(poId, actor) {
        const po = this.poRepo.findById(poId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(poId);
        purchase_order_rules_1.PurchaseOrderRules.validateStatusTransition(po.status, 'pending_approval');
        this.poRepo.updateStatus(po.id, 'pending_approval');
        return this.poRepo.findById(po.id);
    }
    approveOrder(poId, actor) {
        const po = this.poRepo.findById(poId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(poId);
        const settings = this.poRepo.getSettings(po.businessId);
        purchase_order_rules_1.PurchaseOrderRules.validateApproval(po, actor, settings);
        purchase_order_rules_1.PurchaseOrderRules.validateStatusTransition(po.status, 'approved');
        const now = new Date().toISOString();
        this.poRepo.updateStatus(po.id, 'approved', {
            approvedBy: String(actor.userId),
            approvedAt: now
        });
        // CRITICAL: Approving does NOT touch inventory or create supplier payables!
        return this.poRepo.findById(po.id);
    }
    markAsSent(poId, actor) {
        const po = this.poRepo.findById(poId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(poId);
        purchase_order_rules_1.PurchaseOrderRules.validateStatusTransition(po.status, 'sent');
        const now = new Date().toISOString();
        this.poRepo.updateStatus(po.id, 'sent', { sentAt: now });
        return this.poRepo.findById(po.id);
    }
    cancelOrder(poId, reason, actor) {
        const po = this.poRepo.findById(poId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(poId);
        // If any goods have already been received, full cancellation is forbidden
        const totalReceived = (po.lines || []).reduce((acc, l) => acc + l.receivedQuantityScaled, 0);
        if (totalReceived > 0) {
            throw new purchase_order_rules_1.CannotCancelOrderWithReceiptsError(po.purchaseOrderNumber);
        }
        purchase_order_rules_1.PurchaseOrderRules.validateStatusTransition(po.status, 'cancelled');
        this.poRepo.updateStatus(po.id, 'cancelled');
        return this.poRepo.findById(po.id);
    }
    closeOrder(poId, reason, actor) {
        const po = this.poRepo.findById(poId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(poId);
        purchase_order_rules_1.PurchaseOrderRules.validateStatusTransition(po.status, 'closed');
        const now = new Date().toISOString();
        this.poRepo.updateStatus(po.id, 'closed', { closedAt: now });
        return this.poRepo.findById(po.id);
    }
    // =========================================================================
    // 4. GOODS RECEIPT (INCREASES PHYSICAL STOCK ONLY)
    // =========================================================================
    receiveGoods(input, actor) {
        const po = this.poRepo.findById(input.purchaseOrderId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(input.purchaseOrderId);
        // Verify location
        const location = this.locationRepo.findById(input.stockLocationId, po.businessId);
        if (!location) {
            throw new Error(`Stock location '${input.stockLocationId}' not found.`);
        }
        const settings = this.poRepo.getSettings(po.businessId);
        // Validate receipt against rules & over-delivery policy
        purchase_order_rules_1.PurchaseOrderRules.validateGoodsReceipt(po, input.lines, settings, Boolean(input.managerApproved));
        const linesMap = new Map();
        for (const l of po.lines || []) {
            linesMap.set(l.id, l);
        }
        const tx = this.db.transaction(() => {
            const now = input.receiptDate || new Date().toISOString();
            for (const rLine of input.lines) {
                const poLine = linesMap.get(rLine.purchaseOrderLineId);
                const incomingScaled = rLine.receivedQuantityScaled;
                // 1. Update received quantity on PO line
                this.poRepo.updateLineQuantities(poLine.id, incomingScaled, 0);
                // 2. Compute base units using the line's immutable snapshot conversion ratio!
                const baseQtyScaled = Math.round((incomingScaled * poLine.conversionNumerator) / poLine.conversionDenominator);
                const baseQty = baseQtyScaled / 1000;
                // 3. Increment stock location balance
                this.balanceRepo.upsertDelta({
                    businessId: po.businessId,
                    productId: poLine.productId,
                    variantId: poLine.variantId || undefined,
                    stockLocationId: input.stockLocationId,
                    onHandDeltaScaled: baseQtyScaled
                });
                // 4. Update product general stock
                const prod = this.productRepo.findById(poLine.productId);
                if (prod) {
                    this.productRepo.updateStock(prod.id, prod.currentStock + baseQty);
                    // 5. Log traceable stock movement
                    this.productRepo.logStockMovement({
                        productId: prod.id,
                        movementType: accounts_1.StockMovementType.PURCHASE_RECEIPT,
                        quantity: baseQty,
                        previousStock: prod.currentStock,
                        newStock: prod.currentStock + baseQty,
                        stockLocationId: input.stockLocationId,
                        referenceType: 'PURCHASE_ORDER',
                        reason: `Receipt on PO #${po.purchaseOrderNumber}`,
                        userId: Number(actor.userId) || 1
                    });
                }
                // 6. If batch tracking specified and batch number provided, register batch
                if (rLine.batchNumber) {
                    try {
                        this.batchService.receiveBatch({
                            businessId: po.businessId,
                            branchId: po.branchId,
                            stockLocationId: input.stockLocationId,
                            productId: poLine.productId,
                            batchNumber: rLine.batchNumber,
                            expiryDate: rLine.expiryDate,
                            manufacturingDate: rLine.manufacturingDate,
                            quantityScaled: baseQtyScaled,
                            unitCostMinor: poLine.unitPriceMinor,
                            supplierId: po.supplierId,
                            purchaseDocumentLineId: poLine.id
                        });
                    }
                    catch (batchErr) {
                        console.error('[PurchaseOrder Receipt Batch Log Error]:', batchErr);
                    }
                }
                // 7. If serial tracking specified and serial numbers provided, register serials
                if (rLine.serialNumbers && rLine.serialNumbers.length > 0) {
                    try {
                        this.serialService.receiveSerialUnits({
                            businessId: po.businessId,
                            productId: poLine.productId,
                            stockLocationId: input.stockLocationId,
                            supplierId: po.supplierId,
                            purchaseDocumentLineId: poLine.id,
                            quantityScaled: baseQtyScaled,
                            unitCostMinor: poLine.unitPriceMinor,
                            serials: rLine.serialNumbers.map((sn) => ({ serialNumber: sn })),
                            userId: actor.userId
                        });
                    }
                    catch (serialErr) {
                        console.error('[PurchaseOrder Receipt Serial Log Error]:', serialErr);
                    }
                }
            }
            // 8. Refresh and determine new PO status
            const refreshedLines = this.poRepo.getLines(po.id);
            const allFullyReceived = refreshedLines.every((l) => l.receivedQuantityScaled >= l.orderedQuantityScaled);
            const newStatus = allFullyReceived ? 'fully_received' : 'partially_received';
            this.poRepo.updateStatus(po.id, newStatus);
        });
        tx();
        return {
            purchaseOrder: this.poRepo.findById(po.id),
            receivedLinesCount: input.lines.length
        };
    }
    // =========================================================================
    // 5. SUPPLIER INVOICING (RECORDS PAYABLES ONLY, DOES NOT DOUBLE-RECEIVE STOCK)
    // =========================================================================
    recordPurchaseInvoice(input, actor) {
        const po = this.poRepo.findById(input.purchaseOrderId);
        if (!po)
            throw new purchase_order_rules_1.PurchaseOrderNotFoundError(input.purchaseOrderId);
        if (po.status === 'cancelled' || po.status === 'closed') {
            throw new Error(`Cannot invoice purchase order '${po.purchaseOrderNumber}' in status '${po.status}'.`);
        }
        const linesMap = new Map();
        for (const l of po.lines || []) {
            linesMap.set(l.id, l);
        }
        let totalInvoicedMinor = 0;
        const tx = this.db.transaction(() => {
            for (const invLine of input.lines) {
                const poLine = linesMap.get(invLine.purchaseOrderLineId);
                if (!poLine) {
                    throw new Error(`Purchase order line '${invLine.purchaseOrderLineId}' not found.`);
                }
                const qtyScaled = invLine.invoicedQuantityScaled;
                if (qtyScaled <= 0) {
                    throw new Error('Invoiced quantity must be greater than zero.');
                }
                // Update invoiced quantity on line
                this.poRepo.updateLineQuantities(poLine.id, 0, qtyScaled);
                const unitPrice = invLine.invoicedUnitPriceMinor ?? poLine.unitPriceMinor;
                const lineNet = Math.round((qtyScaled / 1000) * unitPrice);
                totalInvoicedMinor += lineNet;
            }
            // Record supplier payable in supplier ledger (DOES NOT TOUCH PHYSICAL STOCK!)
            this.supplierRepo.addLedgerEntry({
                supplierId: po.supplierId,
                entryType: 'SUPPLIER_INVOICE',
                debitMinor: 0,
                creditMinor: totalInvoicedMinor,
                sourceType: 'PURCHASE_ORDER_INVOICE',
                sourceId: po.id,
                referenceId: input.invoiceNumber,
                notes: input.notes || `Invoice ${input.invoiceNumber} for PO #${po.purchaseOrderNumber}`
            });
            // Refresh and determine new status
            const refreshedLines = this.poRepo.getLines(po.id);
            const allFullyInvoiced = refreshedLines.every((l) => l.invoicedQuantityScaled >= l.orderedQuantityScaled);
            const newStatus = allFullyInvoiced ? 'fully_invoiced' : 'partially_invoiced';
            this.poRepo.updateStatus(po.id, newStatus);
        });
        tx();
        return {
            purchaseOrder: this.poRepo.findById(po.id),
            totalInvoicedMinor
        };
    }
    // =========================================================================
    // 6. QUERIES & REPORTS
    // =========================================================================
    findById(id, businessId) {
        return this.poRepo.findById(id, businessId);
    }
    findByOrderNumber(businessId, poNumber) {
        return this.poRepo.findByOrderNumber(businessId, poNumber);
    }
    search(query) {
        return this.poRepo.search(query);
    }
    getOutstandingDeliveryReport(businessId, supplierId) {
        return this.poRepo.getOutstandingDeliveryReport(businessId, supplierId);
    }
    generatePoNumber(businessId) {
        const year = new Date().getFullYear();
        const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM purchase_orders WHERE business_id = ?
    `).get(businessId);
        const seq = (countRow?.count || 0) + 1;
        return `PO-${year}-${String(seq).padStart(5, '0')}`;
    }
}
exports.PurchaseOrderService = PurchaseOrderService;
