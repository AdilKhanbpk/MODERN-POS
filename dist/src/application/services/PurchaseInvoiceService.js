"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseInvoiceService = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../../infrastructure/sqlite/connection");
const PurchaseInvoiceRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseInvoiceRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const GoodsReceiptRepository_1 = require("../../infrastructure/sqlite/repositories/GoodsReceiptRepository");
const PurchaseOrderRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseOrderRepository");
const purchase_invoice_math_1 = require("../../domain/purchase/purchase-invoice-math");
const purchase_invoice_rules_1 = require("../../domain/purchase/purchase-invoice-rules");
class PurchaseInvoiceService {
    db;
    invoiceRepo;
    supplierRepo;
    productRepo;
    balanceRepo;
    grnRepo;
    poRepo;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.invoiceRepo = new PurchaseInvoiceRepository_1.PurchaseInvoiceRepository(this.db);
        this.supplierRepo = new SupplierRepository_1.SupplierRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.grnRepo = new GoodsReceiptRepository_1.GoodsReceiptRepository(this.db);
        this.poRepo = new PurchaseOrderRepository_1.PurchaseOrderRepository(this.db);
    }
    // =========================================================================
    // 1. SETTINGS & ACCOUNTING PERIODS
    // =========================================================================
    getSettings(businessId) {
        return this.invoiceRepo.getSettings(businessId);
    }
    configureSettings(businessId, settings) {
        return this.invoiceRepo.upsertSettings({ ...settings, businessId });
    }
    getAccountingPeriods(businessId) {
        return this.invoiceRepo.getAccountingPeriods(businessId);
    }
    createAccountingPeriod(period) {
        return this.invoiceRepo.createAccountingPeriod(period);
    }
    closeAccountingPeriod(periodId, closedBy) {
        this.invoiceRepo.closeAccountingPeriod(periodId, closedBy);
    }
    // =========================================================================
    // 2. INVOICE CREATION & DRAFT MANAGEMENT
    // =========================================================================
    createInvoice(input, actor) {
        const businessId = input.businessId;
        const settings = this.invoiceRepo.getSettings(businessId);
        // 1. Validate Supplier
        const supplier = this.supplierRepo.findById(input.supplierId);
        if (!supplier) {
            throw new Error(`Supplier '${input.supplierId}' not found.`);
        }
        if (!supplier.isActive) {
            throw new purchase_invoice_rules_1.InactiveSupplierError(supplier.name);
        }
        // 2. Validate Closed Accounting Period
        const closedCheck = this.invoiceRepo.isDateInClosedPeriod(businessId, input.invoiceDate);
        if (closedCheck.isClosed) {
            throw new purchase_invoice_rules_1.ClosedAccountingPeriodError(input.invoiceDate, closedCheck.periodName);
        }
        // 3. Validate Duplicate Supplier Invoice Number
        if (input.supplierInvoiceNumber && input.supplierInvoiceNumber.trim()) {
            const existing = this.invoiceRepo.findBySupplierInvoiceNumber(businessId, input.supplierId, input.supplierInvoiceNumber.trim());
            if (existing) {
                if (settings?.duplicateInvoicePolicy === 'block' || !settings?.duplicateInvoicePolicy) {
                    throw new purchase_invoice_rules_1.DuplicateSupplierInvoiceError(input.supplierInvoiceNumber.trim(), supplier.name);
                }
            }
        }
        // 4. Validate GRN Requirement
        const hasAnyGrnReference = input.lines.some((l) => l.goodsReceiptLineId || (l.allocations && l.allocations.length > 0));
        if (!hasAnyGrnReference && settings && !settings.allowInvoiceBeforeGrn) {
            const isManager = actor.isManager || ['manager', 'admin', 'owner'].includes((actor.role || '').toLowerCase());
            if (!isManager) {
                throw new purchase_invoice_rules_1.InvoiceBeforeGRNNotAllowedError();
            }
        }
        // 5. Validate Line Over-Invoicing against GRN Lines
        for (const line of input.lines) {
            const prod = this.productRepo.findById(line.productId);
            const prodName = prod?.name || `Product #${line.productId}`;
            if (line.goodsReceiptLineId) {
                const grnLine = this.db.prepare(`
          SELECT * FROM goods_receipt_lines WHERE id = ?
        `).get(line.goodsReceiptLineId);
                if (grnLine) {
                    const acceptedScaled = Number(grnLine.base_accepted_quantity_scaled || grnLine.accepted_quantity_scaled || 0);
                    const alreadyInvoicedScaled = this.invoiceRepo.getTotalInvoicedQuantityForGrnLine(line.goodsReceiptLineId);
                    const totalAfterThis = alreadyInvoicedScaled + line.quantityScaled;
                    if (totalAfterThis > acceptedScaled && (!settings?.allowOverInvoicing)) {
                        const isManager = actor.isManager || ['manager', 'admin', 'owner'].includes((actor.role || '').toLowerCase());
                        if (!isManager) {
                            throw new purchase_invoice_rules_1.OverInvoicingError(prodName, totalAfterThis / 1000, acceptedScaled / 1000);
                        }
                    }
                }
            }
            if (line.allocations && line.allocations.length > 0) {
                for (const alloc of line.allocations) {
                    const grnLine = this.db.prepare(`
            SELECT * FROM goods_receipt_lines WHERE id = ?
          `).get(alloc.goodsReceiptLineId);
                    if (grnLine) {
                        const acceptedScaled = Number(grnLine.base_accepted_quantity_scaled || grnLine.accepted_quantity_scaled || 0);
                        const alreadyInvoicedScaled = this.invoiceRepo.getTotalInvoicedQuantityForGrnLine(alloc.goodsReceiptLineId);
                        const totalAfterThis = alreadyInvoicedScaled + alloc.allocatedQuantityScaled;
                        if (totalAfterThis > acceptedScaled && (!settings?.allowOverInvoicing)) {
                            const isManager = actor.isManager || ['manager', 'admin', 'owner'].includes((actor.role || '').toLowerCase());
                            if (!isManager) {
                                throw new purchase_invoice_rules_1.OverInvoicingError(prodName, totalAfterThis / 1000, acceptedScaled / 1000);
                            }
                        }
                    }
                }
            }
        }
        // 6. Calculate Line Values and Header Totals
        const calculatedLines = input.lines.map((l) => {
            const num = l.conversionNumerator || 1;
            const den = l.conversionDenominator || 1;
            const calc = purchase_invoice_math_1.PurchaseInvoiceMath.calculateLineTotal({
                quantityScaled: l.quantityScaled,
                unitPriceMinor: l.unitPriceMinor,
                discountMinor: l.discountMinor,
                taxMinor: l.taxMinor,
                isTaxInclusive: l.isTaxInclusive,
                taxRatePercent: l.taxRatePercent
            });
            return {
                goodsReceiptLineId: l.goodsReceiptLineId || null,
                purchaseOrderLineId: l.purchaseOrderLineId || null,
                productId: String(l.productId),
                variantId: l.variantId ? String(l.variantId) : null,
                batchId: l.batchId ? String(l.batchId) : null,
                descriptionSnapshot: l.descriptionSnapshot || null,
                quantityScaled: l.quantityScaled,
                unitId: String(l.unitId),
                conversionNumerator: num,
                conversionDenominator: den,
                unitPriceMinor: l.unitPriceMinor,
                discountMinor: calc.discountMinor,
                taxProfileId: l.taxProfileId || null,
                taxMinor: calc.taxMinor,
                lineTotalMinor: calc.lineTotalMinor,
                allocations: l.allocations
            };
        });
        const totals = purchase_invoice_math_1.PurchaseInvoiceMath.calculateInvoiceTotals({
            lines: calculatedLines,
            shippingMinor: input.shippingMinor,
            otherChargesMinor: input.otherChargesMinor
        });
        const invoiceNumber = input.invoiceNumber || this.generateInvoiceNumber(businessId);
        const idempotencyKey = input.idempotencyKey || `PINV-IDEMP-${(0, crypto_1.randomUUID)()}`;
        // Resolve valid created_by
        let createdBy = '1';
        if (actor?.userId != null) {
            const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(String(actor.userId));
            if (userExists) {
                createdBy = String(actor.userId);
            }
        }
        return this.invoiceRepo.create({
            businessId,
            branchId: input.branchId,
            supplierId: input.supplierId,
            invoiceNumber,
            supplierInvoiceNumber: input.supplierInvoiceNumber ? input.supplierInvoiceNumber.trim() : null,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate || null,
            currencyCode: input.currencyCode || 'PKR',
            exchangeRateNumerator: input.exchangeRateNumerator || 1,
            exchangeRateDenominator: input.exchangeRateDenominator || 1,
            subtotalMinor: totals.subtotalMinor,
            discountMinor: totals.totalDiscountMinor,
            taxMinor: totals.totalTaxMinor,
            shippingMinor: totals.shippingMinor,
            otherChargesMinor: totals.otherChargesMinor,
            totalMinor: totals.totalMinor,
            paidMinor: 0,
            outstandingMinor: totals.totalMinor,
            status: input.status || 'draft',
            notes: input.notes || null,
            createdBy,
            postedBy: null,
            postedAt: null,
            idempotencyKey
        }, calculatedLines);
    }
    updateInvoice(input, actor) {
        const invoice = this.invoiceRepo.findById(input.id);
        if (!invoice)
            throw new purchase_invoice_rules_1.InvoiceNotFoundError(input.id);
        if (invoice.status === 'posted' || invoice.status === 'paid' || invoice.status === 'partially_paid') {
            throw new Error(`Cannot update purchase invoice #${invoice.invoiceNumber} with status '${invoice.status}'.`);
        }
        const businessId = invoice.businessId;
        const settings = this.invoiceRepo.getSettings(businessId);
        // Validate closed accounting period if date changed
        const targetDate = input.invoiceDate || invoice.invoiceDate;
        const closedCheck = this.invoiceRepo.isDateInClosedPeriod(businessId, targetDate);
        if (closedCheck.isClosed) {
            throw new purchase_invoice_rules_1.ClosedAccountingPeriodError(targetDate, closedCheck.periodName);
        }
        // Validate duplicate supplier invoice number if changed
        if (input.supplierInvoiceNumber && input.supplierInvoiceNumber.trim() !== invoice.supplierInvoiceNumber) {
            const existing = this.invoiceRepo.findBySupplierInvoiceNumber(businessId, invoice.supplierId, input.supplierInvoiceNumber.trim());
            if (existing && existing.id !== invoice.id) {
                if (settings?.duplicateInvoicePolicy === 'block' || !settings?.duplicateInvoicePolicy) {
                    throw new purchase_invoice_rules_1.DuplicateSupplierInvoiceError(input.supplierInvoiceNumber.trim(), invoice.supplierName || 'supplier');
                }
            }
        }
        let calculatedLines = undefined;
        let totals = undefined;
        if (input.lines) {
            calculatedLines = input.lines.map((l) => {
                const num = l.conversionNumerator || 1;
                const den = l.conversionDenominator || 1;
                const calc = purchase_invoice_math_1.PurchaseInvoiceMath.calculateLineTotal({
                    quantityScaled: l.quantityScaled,
                    unitPriceMinor: l.unitPriceMinor,
                    discountMinor: l.discountMinor,
                    taxMinor: l.taxMinor,
                    isTaxInclusive: l.isTaxInclusive,
                    taxRatePercent: l.taxRatePercent
                });
                return {
                    goodsReceiptLineId: l.goodsReceiptLineId || null,
                    purchaseOrderLineId: l.purchaseOrderLineId || null,
                    productId: String(l.productId),
                    variantId: l.variantId ? String(l.variantId) : null,
                    batchId: l.batchId ? String(l.batchId) : null,
                    descriptionSnapshot: l.descriptionSnapshot || null,
                    quantityScaled: l.quantityScaled,
                    unitId: String(l.unitId),
                    conversionNumerator: num,
                    conversionDenominator: den,
                    unitPriceMinor: l.unitPriceMinor,
                    discountMinor: calc.discountMinor,
                    taxProfileId: l.taxProfileId || null,
                    taxMinor: calc.taxMinor,
                    lineTotalMinor: calc.lineTotalMinor,
                    allocations: l.allocations
                };
            });
            totals = purchase_invoice_math_1.PurchaseInvoiceMath.calculateInvoiceTotals({
                lines: calculatedLines,
                shippingMinor: input.shippingMinor ?? invoice.shippingMinor,
                otherChargesMinor: input.otherChargesMinor ?? invoice.otherChargesMinor
            });
        }
        return this.invoiceRepo.update(invoice.id, {
            supplierInvoiceNumber: input.supplierInvoiceNumber !== undefined ? (input.supplierInvoiceNumber ? input.supplierInvoiceNumber.trim() : null) : undefined,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate,
            shippingMinor: input.shippingMinor,
            otherChargesMinor: input.otherChargesMinor,
            notes: input.notes,
            subtotalMinor: totals?.subtotalMinor,
            discountMinor: totals?.totalDiscountMinor,
            taxMinor: totals?.totalTaxMinor,
            totalMinor: totals?.totalMinor,
            outstandingMinor: totals ? totals.totalMinor - invoice.paidMinor : undefined
        }, calculatedLines);
    }
    // =========================================================================
    // 3. THREE-WAY MATCHING (PO vs GRN vs Invoice)
    // =========================================================================
    performThreeWayMatch(purchaseInvoiceId) {
        const invoice = this.invoiceRepo.findById(purchaseInvoiceId);
        if (!invoice)
            throw new purchase_invoice_rules_1.InvoiceNotFoundError(purchaseInvoiceId);
        const settings = this.invoiceRepo.getSettings(invoice.businessId);
        const priceThresholdMinor = settings?.priceVarianceThresholdMinor ?? 1000;
        const priceThresholdPercent = settings?.priceVarianceThresholdPercent ?? 5.0;
        const lines = invoice.lines || [];
        const comparisons = [];
        let totalOrderedScaled = 0;
        let totalAcceptedScaled = 0;
        let totalInvoicedScaled = 0;
        let totalPriceVarianceMinor = 0;
        let hasVarianceExceeded = false;
        let hasQuantityMismatch = false;
        for (const line of lines) {
            totalInvoicedScaled += line.quantityScaled;
            let poLine = null;
            let grnLine = null;
            if (line.purchaseOrderLineId) {
                poLine = this.db.prepare(`
          SELECT * FROM purchase_order_lines WHERE id = ?
        `).get(line.purchaseOrderLineId);
            }
            if (line.goodsReceiptLineId) {
                grnLine = this.db.prepare(`
          SELECT * FROM goods_receipt_lines WHERE id = ?
        `).get(line.goodsReceiptLineId);
                // If poLine not directly linked to invoice line, try to resolve via grnLine
                if (!poLine && grnLine?.purchase_order_line_id) {
                    poLine = this.db.prepare(`
            SELECT * FROM purchase_order_lines WHERE id = ?
          `).get(grnLine.purchase_order_line_id);
                }
            }
            if (poLine) {
                totalOrderedScaled += Number(poLine.ordered_quantity_scaled || 0);
            }
            if (grnLine) {
                totalAcceptedScaled += Number(grnLine.base_accepted_quantity_scaled || grnLine.accepted_quantity_scaled || 0);
            }
            const comp = purchase_invoice_math_1.PurchaseInvoiceMath.evaluateThreeWayMatchLine({
                lineId: line.id,
                productId: line.productId,
                productName: line.productName || `Product #${line.productId}`,
                unitId: line.unitId,
                unitName: line.unitName || 'Unit',
                invoicedQuantityScaled: line.quantityScaled,
                invoicedUnitPriceMinor: line.unitPriceMinor,
                purchaseOrderLineId: line.purchaseOrderLineId || grnLine?.purchase_order_line_id || null,
                orderedQuantityScaled: poLine ? Number(poLine.ordered_quantity_scaled) : null,
                poUnitPriceMinor: poLine ? Number(poLine.unit_price_minor) : null,
                goodsReceiptLineId: line.goodsReceiptLineId || null,
                acceptedQuantityScaled: grnLine ? Number(grnLine.base_accepted_quantity_scaled || grnLine.accepted_quantity_scaled) : null,
                grnUnitCostMinor: grnLine ? Number(grnLine.unit_cost_minor) : null,
                priceThresholdMinor,
                priceThresholdPercent
            });
            comparisons.push(comp);
            totalPriceVarianceMinor += comp.totalFinancialVarianceMinor;
            if (comp.status === 'variance_exceeded')
                hasVarianceExceeded = true;
            if (comp.status === 'quantity_mismatch')
                hasQuantityMismatch = true;
        }
        let overallStatus = 'exact_match';
        if (hasQuantityMismatch) {
            overallStatus = 'quantity_mismatch';
        }
        else if (hasVarianceExceeded || Math.abs(totalPriceVarianceMinor) > priceThresholdMinor) {
            overallStatus = 'variance_exceeded';
        }
        else if (comparisons.some((c) => c.status === 'acceptable_variance')) {
            overallStatus = 'acceptable_variance';
        }
        else if (comparisons.every((c) => c.status === 'no_po_reference')) {
            overallStatus = 'no_po_reference';
        }
        const requiresManagerApproval = overallStatus === 'variance_exceeded' || overallStatus === 'quantity_mismatch';
        return {
            purchaseInvoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            supplierId: invoice.supplierId,
            supplierName: invoice.supplierName || 'Supplier',
            overallStatus,
            requiresManagerApproval,
            totalOrderedQuantityScaled: totalOrderedScaled,
            totalAcceptedQuantityScaled: totalAcceptedScaled,
            totalInvoicedQuantityScaled: totalInvoicedScaled,
            totalPriceVarianceMinor,
            lines: comparisons
        };
    }
    // =========================================================================
    // 4. ATOMIC FINANCIAL POSTING & COST RECONCILIATION
    // =========================================================================
    postInvoice(input, actor) {
        const invoice = this.invoiceRepo.findById(input.purchaseInvoiceId);
        if (!invoice)
            throw new purchase_invoice_rules_1.InvoiceNotFoundError(input.purchaseInvoiceId);
        // IDEMPOTENCY CHECK: If already posted, return immediately without duplicate ledger entry!
        if (invoice.status === 'posted' || invoice.status === 'partially_paid' || invoice.status === 'paid') {
            return invoice;
        }
        const supplier = this.supplierRepo.findById(invoice.supplierId);
        if (!supplier || !supplier.isActive) {
            throw new purchase_invoice_rules_1.InactiveSupplierError(supplier?.name || 'Inactive Supplier');
        }
        const settings = this.invoiceRepo.getSettings(invoice.businessId);
        // Evaluate 3-Way Match & Permissions
        const matchReport = this.performThreeWayMatch(invoice.id);
        purchase_invoice_rules_1.PurchaseInvoiceRules.validatePosting(invoice, matchReport, settings, actor, input.managerApproved);
        const now = new Date().toISOString();
        // Resolve valid postedBy
        let postedBy = '1';
        if (actor?.userId != null) {
            const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(String(actor.userId));
            if (userExists) {
                postedBy = String(actor.userId);
            }
        }
        const tx = this.db.transaction(() => {
            // 1. Mark Invoice as POSTED
            this.invoiceRepo.updateStatus(invoice.id, 'posted', {
                postedBy,
                postedAt: now
            });
            // 2. Post CREDIT entry to supplier_ledger_entries (increases payable liability to supplier)
            // Base currency total: if invoice has currency conversion, convert to base minor
            const basePayableMinor = purchase_invoice_math_1.PurchaseInvoiceMath.convertCurrency(invoice.totalMinor, invoice.exchangeRateNumerator, invoice.exchangeRateDenominator);
            this.supplierRepo.addLedgerEntry({
                supplierId: invoice.supplierId,
                entryType: 'PURCHASE_BILL',
                debitMinor: 0,
                creditMinor: basePayableMinor,
                sourceType: 'purchase_invoice',
                sourceId: invoice.id,
                notes: `Purchase Invoice #${invoice.invoiceNumber}${invoice.supplierInvoiceNumber ? ` (Supplier Ref: ${invoice.supplierInvoiceNumber})` : ''}`
            });
            // 3. Reconcile Provisional Inventory Cost Layers (WITHOUT duplicating or altering stock)
            if (input.reconcileCostLayers !== false) {
                const lines = invoice.lines || [];
                for (const line of lines) {
                    if (line.goodsReceiptLineId) {
                        // Find GRN line and associated stock movement
                        const grnLine = this.db.prepare(`
              SELECT l.*, m.id as movement_id
              FROM goods_receipt_lines l
              LEFT JOIN stock_movements m ON m.reference_id = l.goods_receipt_id AND m.reference_line_id = l.id
              WHERE l.id = ?
            `).get(line.goodsReceiptLineId);
                        if (grnLine?.movement_id) {
                            const invoicedUnitCostMinor = line.unitPriceMinor;
                            // Update remaining inventory_cost_layers originating from this movement to final invoiced cost
                            this.db.prepare(`
                UPDATE inventory_cost_layers
                SET unit_cost_minor = ?
                WHERE source_movement_id = ? AND remaining_quantity_scaled > 0
              `).run(invoicedUnitCostMinor, grnLine.movement_id);
                        }
                    }
                }
            }
        });
        tx();
        return this.invoiceRepo.findById(invoice.id);
    }
    // =========================================================================
    // 5. INVOICE VOIDING / REVERSAL
    // =========================================================================
    voidInvoice(invoiceId, reason, actor) {
        const invoice = this.invoiceRepo.findById(invoiceId);
        if (!invoice)
            throw new purchase_invoice_rules_1.InvoiceNotFoundError(invoiceId);
        purchase_invoice_rules_1.PurchaseInvoiceRules.validateVoid(invoice);
        const now = new Date().toISOString();
        const tx = this.db.transaction(() => {
            if (invoice.status === 'posted') {
                // Reverse supplier payable via DEBIT entry in supplier_ledger_entries
                const basePayableMinor = purchase_invoice_math_1.PurchaseInvoiceMath.convertCurrency(invoice.totalMinor, invoice.exchangeRateNumerator, invoice.exchangeRateDenominator);
                this.supplierRepo.addLedgerEntry({
                    supplierId: invoice.supplierId,
                    entryType: 'ADJUSTMENT',
                    debitMinor: basePayableMinor,
                    creditMinor: 0,
                    sourceType: 'purchase_invoice_void',
                    sourceId: invoice.id,
                    notes: `Voided Purchase Invoice #${invoice.invoiceNumber}. Reason: ${reason}`
                });
            }
            this.invoiceRepo.updateStatus(invoice.id, 'voided');
        });
        tx();
        return this.invoiceRepo.findById(invoice.id);
    }
    // =========================================================================
    // 6. PAYMENT ALLOCATION
    // =========================================================================
    allocatePayment(input, actor) {
        const invoice = this.invoiceRepo.findById(input.purchaseInvoiceId);
        if (!invoice)
            throw new purchase_invoice_rules_1.InvoiceNotFoundError(input.purchaseInvoiceId);
        if (invoice.status !== 'posted' && invoice.status !== 'partially_paid') {
            throw new Error(`Cannot record payment against invoice #${invoice.invoiceNumber} in '${invoice.status}' status.`);
        }
        if (input.amountMinor <= 0) {
            throw new Error('Payment amount must be greater than zero.');
        }
        const remainingDue = invoice.outstandingMinor;
        if (input.amountMinor > remainingDue) {
            throw new Error(`Payment amount of ${input.amountMinor} exceeds invoice remaining due of ${remainingDue}.`);
        }
        const now = new Date().toISOString();
        const paymentId = (0, crypto_1.randomUUID)();
        const tx = this.db.transaction(() => {
            // 1. Create supplier payment record
            this.db.prepare(`
        INSERT INTO supplier_payments (
          id, business_id, supplier_id, payment_number, payment_date,
          amount_minor, payment_method, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(paymentId, invoice.businessId, invoice.supplierId, `SPAY-${Date.now()}`, input.paymentDate || now, input.amountMinor, input.paymentMethod, input.notes || `Payment against Invoice #${invoice.invoiceNumber}`, now);
            // 2. Create payment allocation record
            this.db.prepare(`
        INSERT INTO supplier_payment_allocations (
          id, business_id, supplier_payment_id, purchase_document_id, allocated_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run((0, crypto_1.randomUUID)(), invoice.businessId, paymentId, invoice.id, input.amountMinor, now);
            // 3. Post DEBIT entry to supplier_ledger_entries (payment decreases liability)
            this.supplierRepo.addLedgerEntry({
                supplierId: invoice.supplierId,
                entryType: 'PAYMENT_DISBURSED',
                debitMinor: input.amountMinor,
                creditMinor: 0,
                sourceType: 'supplier_payment',
                sourceId: paymentId,
                notes: `Payment towards Purchase Invoice #${invoice.invoiceNumber}`
            });
            // 4. Update Invoice paid & outstanding amounts
            this.invoiceRepo.updatePayment(invoice.id, input.amountMinor);
        });
        tx();
        return this.invoiceRepo.findById(invoice.id);
    }
    // =========================================================================
    // 7. IMPORT FROM GOODS RECEIPTS
    // =========================================================================
    /**
     * Constructs draft invoice lines by importing accepted quantities from one or more GRNs.
     */
    importFromGoodsReceipts(receiptIds, businessId) {
        if (receiptIds.length === 0) {
            throw new Error('At least one Goods Receipt ID is required to import.');
        }
        let supplierId = '';
        let branchId = '';
        const importedLines = [];
        for (const receiptId of receiptIds) {
            const receipt = this.grnRepo.findById(receiptId, businessId);
            if (!receipt) {
                throw new Error(`Goods Receipt '${receiptId}' not found.`);
            }
            if (!supplierId) {
                supplierId = receipt.supplierId;
                branchId = receipt.branchId;
            }
            else if (supplierId !== receipt.supplierId) {
                throw new Error('All selected Goods Receipts must belong to the same supplier.');
            }
            for (const line of receipt.lines || []) {
                const accepted = line.acceptedQuantityScaled;
                if (accepted <= 0)
                    continue;
                const alreadyInvoiced = this.invoiceRepo.getTotalInvoicedQuantityForGrnLine(line.id);
                const remainingToInvoice = Math.max(0, accepted - alreadyInvoiced);
                if (remainingToInvoice > 0) {
                    importedLines.push({
                        goodsReceiptLineId: line.id,
                        purchaseOrderLineId: line.purchaseOrderLineId || null,
                        productId: line.productId,
                        productName: line.productName || 'Product',
                        quantityScaled: remainingToInvoice,
                        unitId: line.purchaseUnitId,
                        unitName: line.purchaseUnitName || 'Unit',
                        unitPriceMinor: line.unitCostMinor || 0,
                        conversionNumerator: line.conversionNumerator,
                        conversionDenominator: line.conversionDenominator
                    });
                }
            }
        }
        return {
            supplierId,
            branchId,
            lines: importedLines
        };
    }
    // =========================================================================
    // 8. QUERY API
    // =========================================================================
    findById(id, businessId) {
        return this.invoiceRepo.findById(id, businessId);
    }
    listInvoices(filter) {
        return this.invoiceRepo.list(filter);
    }
    // =========================================================================
    // 9. HELPER
    // =========================================================================
    generateInvoiceNumber(businessId) {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM purchase_invoices WHERE business_id = ?
    `).get(businessId);
        const seq = String((countRow?.count || 0) + 1).padStart(4, '0');
        return `PINV-${today}-${seq}`;
    }
}
exports.PurchaseInvoiceService = PurchaseInvoiceService;
