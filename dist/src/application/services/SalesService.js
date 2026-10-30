"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesService = void 0;
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const CustomerRepository_1 = require("../../infrastructure/sqlite/repositories/CustomerRepository");
const SaleRepository_1 = require("../../infrastructure/sqlite/repositories/SaleRepository");
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const pricing_calculator_1 = require("../../domain/sales/pricing-calculator");
const stock_rules_1 = require("../../domain/inventory/stock-rules");
const stock_location_rules_1 = require("../../domain/inventory/stock-location-rules");
const stocktake_rules_1 = require("../../domain/inventory/stocktake-rules");
const stock_reservation_rules_1 = require("../../domain/inventory/stock-reservation-rules");
const StockReservationRepository_1 = require("../../infrastructure/sqlite/repositories/StockReservationRepository");
const StockReservationService_1 = require("./StockReservationService");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const double_entry_1 = require("../../domain/accounting/double-entry");
const accounts_1 = require("../../shared/constants/accounts");
const batch_expiry_rules_1 = require("../../domain/inventory/batch-expiry-rules");
const BatchExpiryService_1 = require("./BatchExpiryService");
const serial_rules_1 = require("../../domain/inventory/serial-rules");
const SerialTrackingService_1 = require("./SerialTrackingService");
const crypto_1 = require("crypto");
class SalesService {
    saleRepo;
    productRepo;
    customerRepo;
    accountRepo;
    constructor(saleRepo = new SaleRepository_1.SaleRepository(), productRepo = new ProductRepository_1.ProductRepository(), customerRepo = new CustomerRepository_1.CustomerRepository(), accountRepo = new AccountRepository_1.AccountRepository()) {
        this.saleRepo = saleRepo;
        this.productRepo = productRepo;
        this.customerRepo = customerRepo;
        this.accountRepo = accountRepo;
    }
    /**
     * Domain-only calculation preview for UI (UI never calculates final truth!).
     */
    calculate(items, orderDiscountPercent = 0, orderDiscountAmount = 0) {
        return pricing_calculator_1.PricingCalculator.calculateSale(items, orderDiscountPercent, orderDiscountAmount);
    }
    /**
     * Processes a complete sale transaction with atomic inventory deduction and accounting ledger entries.
     */
    createSale(request) {
        if (!request.items || request.items.length === 0) {
            throw new Error('Sale must contain at least one item');
        }
        // 1. Calculate pricing via shared Domain Layer
        const calculation = pricing_calculator_1.PricingCalculator.calculateSale(request.items, request.orderDiscountPercent || 0, request.orderDiscountAmount || 0);
        // 2. Validate payment splits / credit
        const isCredit = Boolean(request.isCredit || request.paymentMethod === accounts_1.PaymentMethod.CREDIT);
        const splitPayment = pricing_calculator_1.PricingCalculator.calculatePaymentSplit(calculation.grandTotal, request.amountPaid, isCredit);
        // Resolve customer and check credit rules
        let effectiveCustomerId = request.customerId;
        if (splitPayment.customerBalanceChange > 0) {
            if (!effectiveCustomerId) {
                throw new Error('Customer must be selected for credit transactions');
            }
            const customer = this.customerRepo.findById(effectiveCustomerId);
            if (!customer) {
                throw new Error('Customer not found');
            }
            if (customer.isActive === false) {
                throw new Error(`Customer "${customer.name}" is inactive and cannot purchase on credit.`);
            }
            if (customer.customerCode === 'WALK-IN' || customer.name === 'Walk-in Customer') {
                throw new Error('Credit sales cannot be charged to the Walk-in customer account.');
            }
            if (customer.creditLimit > 0 && (customer.balance + splitPayment.customerBalanceChange > customer.creditLimit)) {
                throw new Error(`Credit limit exceeded! Allowed: ${customer.creditLimit / 100}, Attempted: ${(customer.balance + splitPayment.customerBalanceChange) / 100}`);
            }
        }
        else if (!effectiveCustomerId) {
            // Cash sale: default to Walk-in customer if not specified
            const walkIn = this.customerRepo.list().find(c => c.customerCode === 'WALK-IN');
            if (walkIn) {
                effectiveCustomerId = walkIn.id;
            }
        }
        // 3. Perform atomic database transaction
        const targetDb = this.saleRepo?.db || this.productRepo?.db;
        return transaction_runner_1.TransactionRunner.run((db) => {
            // Step A0: Resolve and validate Stock Location (Prompt 11)
            let stockLoc = null;
            try {
                if (request.locationId) {
                    stockLoc = db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(String(request.locationId));
                }
                else {
                    if (request.counterId) {
                        stockLoc = db.prepare(`
              SELECT l.* FROM counter_stock_locations csl
              JOIN stock_locations l ON csl.stock_location_id = l.id
              WHERE csl.counter_id = ? AND csl.is_default = 1 AND l.is_active = 1
            `).get(request.counterId);
                    }
                    if (!stockLoc && request.branchId) {
                        stockLoc = db.prepare(`
              SELECT * FROM stock_locations
              WHERE branch_id = ? AND is_default = 1 AND is_active = 1
            `).get(request.branchId);
                    }
                    if (!stockLoc) {
                        stockLoc = db.prepare(`
              SELECT * FROM stock_locations
              WHERE is_default = 1 AND is_active = 1
              LIMIT 1
            `).get();
                    }
                }
            }
            catch {
                // Migration not yet applied or table unavailable
            }
            if (stockLoc) {
                stock_location_rules_1.StockLocationRules.validateSellable({
                    name: stockLoc.name,
                    isActive: Boolean(stockLoc.is_active),
                    isSellable: Boolean(stockLoc.is_sellable),
                    locationType: stockLoc.location_type
                });
                // Prompt 14 Policy A: Check Location Freeze
                try {
                    const frozenRow = db.prepare(`
            SELECT id, stocktake_number FROM stocktakes
            WHERE stock_location_id = ?
              AND freeze_stock = 1
              AND status IN ('in_progress', 'count_submitted', 'review', 'approved')
            LIMIT 1
          `).get(stockLoc.id);
                    if (frozenRow) {
                        stocktake_rules_1.StocktakeRules.validateLocationFreeze(true, stockLoc.name, frozenRow.stocktake_number, Boolean(request.overrideFreeze || request.overrideLocationFreeze), request.userRole || request.role);
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
            }
            // Sweep expired reservations before evaluating stock availability
            try {
                const resService = new StockReservationService_1.StockReservationService(db);
                resService.checkAndExpireReservations(stockLoc?.business_id);
            }
            catch {
                // Table or service may not be available in early isolated tests
            }
            let activeReservation = null;
            if (request.reservationId) {
                const resRepo = new StockReservationRepository_1.StockReservationRepository(db);
                activeReservation = resRepo.findById(request.reservationId);
                if (!activeReservation) {
                    throw new Error(`Reservation '${request.reservationId}' not found.`);
                }
                if (activeReservation.status === 'cancelled') {
                    throw new Error(`Reservation '${activeReservation.reservationNumber}' is cancelled and cannot be fulfilled.`);
                }
                if (activeReservation.status === 'fulfilled') {
                    throw new Error(`Reservation '${activeReservation.reservationNumber}' is already completely fulfilled.`);
                }
                if (activeReservation.status === 'expired' || stock_reservation_rules_1.StockReservationRules.isExpired(activeReservation.expiresAt)) {
                    throw new Error(`Reservation '${activeReservation.reservationNumber}' is expired.`);
                }
            }
            // Step A: Validate stock and deduct inventory
            const itemBatchAllocationsMap = new Map();
            const itemSerialAllocationsMap = new Map();
            for (let itemIdx = 0; itemIdx < request.items.length; itemIdx++) {
                const item = request.items[itemIdx];
                const product = this.productRepo.findById(item.productId);
                if (!product) {
                    throw new Error(`Product ID ${item.productId} not found`);
                }
                const baseQtyNeeded = item.quantity * item.conversionFactor;
                const baseQtyNeededScaled = Math.round(baseQtyNeeded * 1000);
                // Check if product requires batch tracking
                let batchSettings = null;
                try {
                    batchSettings = db.prepare('SELECT * FROM product_batch_settings WHERE product_id = ?').get(product.id);
                }
                catch {
                    // Table may not exist in early tests
                }
                const requiresBatch = Boolean(batchSettings?.requires_batch);
                let allocations = [];
                if (item.batchAllocations && item.batchAllocations.length > 0) {
                    for (const alloc of item.batchAllocations) {
                        const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(alloc.batchId);
                        if (!batch)
                            throw new batch_expiry_rules_1.BatchNotFoundError(alloc.batchId);
                        batch_expiry_rules_1.BatchExpiryRules.validateSaleBatchEligibility(batch, batchSettings ? {
                            id: batchSettings.id,
                            businessId: batchSettings.business_id,
                            productId: batchSettings.product_id,
                            requiresBatch: Boolean(batchSettings.requires_batch),
                            requiresExpiry: Boolean(batchSettings.requires_expiry),
                            expiryWarningDays: Number(batchSettings.expiry_warning_days),
                            expirySalePolicy: batchSettings.expiry_sale_policy,
                            batchCostPolicy: batchSettings.batch_cost_policy,
                            createdAt: batchSettings.created_at,
                            updatedAt: batchSettings.updated_at
                        } : null);
                        allocations.push({
                            batchId: batch.id,
                            batchNumber: batch.batch_number,
                            expiryDate: batch.expiry_date,
                            quantityScaled: alloc.quantityScaled,
                            unitCostMinor: batch.cost_minor || 0
                        });
                    }
                }
                else if (item.batchId) {
                    const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(item.batchId);
                    if (!batch)
                        throw new batch_expiry_rules_1.BatchNotFoundError(item.batchId);
                    batch_expiry_rules_1.BatchExpiryRules.validateSaleBatchEligibility(batch, batchSettings ? {
                        id: batchSettings.id,
                        businessId: batchSettings.business_id,
                        productId: batchSettings.product_id,
                        requiresBatch: Boolean(batchSettings.requires_batch),
                        requiresExpiry: Boolean(batchSettings.requires_expiry),
                        expiryWarningDays: Number(batchSettings.expiry_warning_days),
                        expirySalePolicy: batchSettings.expiry_sale_policy,
                        batchCostPolicy: batchSettings.batch_cost_policy,
                        createdAt: batchSettings.created_at,
                        updatedAt: batchSettings.updated_at
                    } : null);
                    allocations.push({
                        batchId: batch.id,
                        batchNumber: batch.batch_number,
                        expiryDate: batch.expiry_date,
                        quantityScaled: baseQtyNeededScaled,
                        unitCostMinor: batch.cost_minor || 0
                    });
                }
                else if (requiresBatch && stockLoc) {
                    // Automated FEFO allocation
                    const batchService = new BatchExpiryService_1.BatchExpiryService(db);
                    allocations = batchService.allocateBatchesForSale({
                        businessId: stockLoc.business_id,
                        productId: product.id,
                        stockLocationId: stockLoc.id,
                        requestedQuantityScaled: baseQtyNeededScaled
                    });
                }
                if (requiresBatch && allocations.length === 0) {
                    throw new batch_expiry_rules_1.BatchRequiredError(product.name);
                }
                if (allocations.length > 0) {
                    const totalAllocated = allocations.reduce((s, a) => s + a.quantityScaled, 0);
                    if (totalAllocated < baseQtyNeededScaled) {
                        throw new batch_expiry_rules_1.InsufficientBatchStockError(allocations[0]?.batchNumber || 'Batch', baseQtyNeededScaled / 1000, totalAllocated / 1000);
                    }
                    if (stockLoc) {
                        for (const alloc of allocations) {
                            db.prepare(`
                UPDATE batch_stock_balances
                SET on_hand_scaled = on_hand_scaled - ?,
                    updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
                WHERE business_id = ? AND batch_id = ? AND stock_location_id = ?
              `).run(alloc.quantityScaled, stockLoc.business_id, alloc.batchId, stockLoc.id);
                        }
                    }
                    itemBatchAllocationsMap.set(itemIdx, allocations);
                }
                // Check if product requires serial tracking
                let serialSettings = null;
                try {
                    serialSettings = db.prepare('SELECT * FROM product_serial_settings WHERE product_id = ?').get(product.id);
                }
                catch {
                    // Table may not exist in early tests
                }
                const requiresSerial = Boolean(serialSettings?.serial_tracking_required);
                if (requiresSerial) {
                    const expectedCount = Math.round(baseQtyNeededScaled / 1000);
                    const serialService = new SerialTrackingService_1.SerialTrackingService(db);
                    if (!item.serialNumbers || item.serialNumbers.length === 0) {
                        throw new serial_rules_1.SerialRequiredError(product.name);
                    }
                    if (item.serialNumbers.length !== expectedCount) {
                        throw new serial_rules_1.SerialCountMismatchError(product.name, expectedCount, item.serialNumbers.length);
                    }
                    const allocatedSerials = serialService.validateAndAllocateSaleSerials({
                        businessId: stockLoc?.business_id || request.businessId || '00000000-0000-0000-0000-000000000001',
                        productId: String(product.id),
                        stockLocationId: stockLoc ? stockLoc.id : '00000000-0000-0000-0000-000000000001',
                        quantityScaled: baseQtyNeededScaled,
                        serials: item.serialNumbers
                    });
                    itemSerialAllocationsMap.set(itemIdx, allocatedSerials);
                }
                if (stockLoc) {
                    const balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(db);
                    const balance = balanceRepo.getBalance(product.id, stockLoc.id, stockLoc.business_id);
                    if (balance) {
                        if (activeReservation) {
                            const resLine = (activeReservation.lines || []).find((l) => String(l.productId) === String(product.id) && l.stockLocationId === stockLoc.id);
                            if (resLine) {
                                stock_reservation_rules_1.StockReservationRules.validateFulfillment(activeReservation, resLine, baseQtyNeededScaled);
                                const resRepo = new StockReservationRepository_1.StockReservationRepository(db);
                                resRepo.updateLineQuantities(resLine.id, baseQtyNeededScaled, 0);
                                // Relieve reserved commitment
                                balanceRepo.upsertDelta({
                                    businessId: stockLoc.business_id,
                                    productId: product.id,
                                    stockLocationId: stockLoc.id,
                                    onHandDeltaScaled: 0,
                                    reservedDeltaScaled: -baseQtyNeededScaled
                                });
                                resLine.fulfilledQuantityScaled += baseQtyNeededScaled;
                            }
                            else {
                                // Item is not on the reservation; evaluate against remaining available stock
                                stock_reservation_rules_1.StockReservationRules.validateSaleAvailability(product.name, balance.onHandScaled, balance.reservedScaled, baseQtyNeededScaled);
                            }
                        }
                        else {
                            // Ordinary sale without reservation: strictly forbidden from consuming reserved stock
                            stock_reservation_rules_1.StockReservationRules.validateSaleAvailability(product.name, balance.onHandScaled, balance.reservedScaled, baseQtyNeededScaled);
                        }
                    }
                }
                const validation = stock_rules_1.StockRules.validateAvailability(product.currentStock, baseQtyNeeded, false);
                if (!validation.isValid) {
                    throw new Error(`Product '${product.name}' stock shortage: ${validation.message}`);
                }
                const newStock = stock_rules_1.StockRules.computeNewStock(product.currentStock, accounts_1.StockMovementType.SALE, baseQtyNeeded);
                this.productRepo.updateStock(product.id, newStock);
                if (stockLoc) {
                    const balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(db);
                    balanceRepo.upsertDelta({
                        businessId: stockLoc.business_id,
                        productId: product.id,
                        stockLocationId: stockLoc.id,
                        onHandDeltaScaled: -baseQtyNeededScaled
                    });
                }
                this.productRepo.logStockMovement({
                    productId: product.id,
                    movementType: accounts_1.StockMovementType.SALE,
                    quantity: baseQtyNeeded,
                    previousStock: product.currentStock,
                    newStock,
                    stockLocationId: stockLoc?.id,
                    referenceType: 'SALE',
                    reason: activeReservation ? `Reservation ${activeReservation.reservationNumber} fulfillment` : 'Retail sale deduction',
                    userId: request.cashierId
                });
                // Set batch_id on movement if batch allocated
                if (allocations.length > 0) {
                    try {
                        db.prepare(`
              UPDATE stock_movements
              SET batch_id = ?
              WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)
            `).run(allocations[0].batchId, product.id);
                    }
                    catch {
                        // Safe fallback
                    }
                }
                // Set serial_number_id on movement if serial allocated
                const serialAllocations = itemSerialAllocationsMap.get(itemIdx);
                if (serialAllocations && serialAllocations.length > 0) {
                    try {
                        db.prepare(`
              UPDATE stock_movements
              SET serial_number_id = ?
              WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)
            `).run(serialAllocations[0].id, product.id);
                    }
                    catch {
                        // Safe fallback
                    }
                }
            }
            // If fulfilling a reservation, evaluate whether it is now completely fulfilled
            if (activeReservation) {
                const resRepo = new StockReservationRepository_1.StockReservationRepository(db);
                const refreshedRes = resRepo.findById(activeReservation.id);
                if (refreshedRes) {
                    const allFulfilled = (refreshedRes.lines || []).every((l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled);
                    const newStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';
                    resRepo.updateStatus(activeReservation.id, newStatus);
                }
            }
            // Step B: Generate Invoice Number and save Sale
            const invoiceNumber = this.saleRepo.getNextInvoiceNumber();
            const saleId = this.saleRepo.create({
                invoiceNumber,
                customerId: effectiveCustomerId,
                cashierId: request.cashierId,
                subtotal: calculation.subtotal,
                totalDiscount: calculation.totalDiscount,
                totalTax: calculation.totalTax,
                grandTotal: calculation.grandTotal,
                totalCost: calculation.totalCostPrice,
                profit: calculation.estimatedProfit,
                paymentMethod: request.paymentMethod || (isCredit ? 'CREDIT' : 'CASH'),
                amountPaid: request.amountPaid,
                changeGiven: splitPayment.changeGiven,
                customerBalanceChange: splitPayment.customerBalanceChange,
                notes: request.notes
            });
            // Step C: Insert sale items
            for (let i = 0; i < calculation.items.length; i++) {
                const item = calculation.items[i];
                const product = this.productRepo.findById(item.productId);
                const saleItemId = this.saleRepo.createItem({
                    saleId,
                    productId: item.productId,
                    productName: product ? product.name : 'Unknown Product',
                    productBarcode: (product && product.barcode) ? product.barcode : (product?.sku || 'N/A'),
                    unitName: item.unitName || 'Piece',
                    quantity: item.quantity,
                    conversionFactor: item.conversionFactor,
                    unitPrice: item.unitPrice,
                    costPrice: item.costPrice ?? (product?.costPrice || product?.default_cost_minor || 0),
                    lineDiscount: item.lineDiscount,
                    lineTax: item.lineTax,
                    lineTotal: item.lineTotal,
                    lineProfit: item.lineProfit
                });
                const allocations = itemBatchAllocationsMap.get(i);
                if (allocations && allocations.length > 0 && saleItemId) {
                    for (const alloc of allocations) {
                        try {
                            db.prepare(`
                INSERT INTO sale_item_batches (
                  id, business_id, sale_id, sale_item_id, product_id, batch_id, quantity_scaled, unit_cost_minor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
              `).run((0, crypto_1.randomUUID)(), stockLoc?.business_id || '00000000-0000-0000-0000-000000000001', String(saleId), String(saleItemId), String(item.productId), alloc.batchId, alloc.quantityScaled, alloc.unitCostMinor || 0);
                        }
                        catch (sibErr) {
                            console.error('[SaleItemBatches Insert Error]:', sibErr);
                        }
                    }
                }
                const serialAllocations = itemSerialAllocationsMap.get(i);
                if (serialAllocations && serialAllocations.length > 0 && saleItemId) {
                    const serialService = new SerialTrackingService_1.SerialTrackingService(db);
                    serialService.claimSaleSerials(serialAllocations, saleId, saleItemId, stockLoc?.business_id || request.businessId || '00000000-0000-0000-0000-000000000001', request.cashierId);
                }
            }
            // Step D: Update Customer Balance and Ledger if credit used
            if (request.customerId && splitPayment.customerBalanceChange > 0) {
                const customer = this.customerRepo.findById(request.customerId);
                const newBalance = customer.balance + splitPayment.customerBalanceChange;
                this.customerRepo.updateBalance(customer.id, newBalance);
                this.customerRepo.addLedgerEntry({
                    customerId: customer.id,
                    transactionType: 'SALE_CREDIT',
                    referenceId: saleId,
                    debit: splitPayment.customerBalanceChange,
                    credit: 0,
                    runningBalance: newBalance,
                    notes: `Invoice ${invoiceNumber}`
                });
            }
            // Step E: Double-Entry General Ledger Posting
            const cashAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.CASH_ON_HAND);
            const receivableAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.ACCOUNTS_RECEIVABLE);
            const revenueAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.SALES_REVENUE);
            const taxPayableAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.SALES_TAX_PAYABLE);
            const cogsAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.COST_OF_GOODS_SOLD);
            const inventoryAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.INVENTORY_ASSET);
            if (cashAccount && receivableAccount && revenueAccount && taxPayableAccount && cogsAccount && inventoryAccount) {
                const journalLines = double_entry_1.DoubleEntryLedger.createSaleJournalLines({
                    cashAccountId: cashAccount.id,
                    receivableAccountId: receivableAccount.id,
                    salesRevenueAccountId: revenueAccount.id,
                    taxPayableAccountId: taxPayableAccount.id,
                    cogsAccountId: cogsAccount.id,
                    inventoryAccountId: inventoryAccount.id,
                    cashReceived: Math.min(calculation.grandTotal, request.amountPaid),
                    creditAmount: splitPayment.customerBalanceChange,
                    grossSales: calculation.grandTotal,
                    salesTax: calculation.totalTax,
                    costOfGoodsSold: calculation.totalCostPrice
                });
                // Verify balance
                const balanceCheck = double_entry_1.DoubleEntryLedger.validateBalance(journalLines);
                if (!balanceCheck.isBalanced) {
                    throw new Error(`Ledger entry out of balance by ${balanceCheck.discrepancy} cents`);
                }
                // Save journal entry
                this.accountRepo.createJournalEntry({
                    entryNumber: `JE-${invoiceNumber}`,
                    referenceType: 'SALE',
                    referenceId: saleId,
                    description: `Sale ${invoiceNumber}`,
                    totalAmount: calculation.grandTotal,
                    lines: journalLines
                });
                // Update Account running balances
                for (const line of journalLines) {
                    const acc = this.accountRepo.findById(line.accountId);
                    if (acc) {
                        const updatedBalance = double_entry_1.DoubleEntryLedger.computeAccountBalance(acc.balance, acc.type, line.debit, line.credit);
                        this.accountRepo.updateBalance(acc.id, updatedBalance);
                    }
                }
            }
            const createdSale = this.saleRepo.findById(saleId);
            if (!createdSale) {
                throw new Error('Failed to retrieve newly created sale');
            }
            return createdSale;
        }, targetDb);
    }
    getSaleById(id) {
        return this.saleRepo.findById(id);
    }
    listSales(limit = 100) {
        return this.saleRepo.list(limit);
    }
    voidSale(id, cashierId) {
        const targetDb = this.saleRepo?.db || this.productRepo?.db;
        transaction_runner_1.TransactionRunner.run((db) => {
            const sale = this.saleRepo.findById(id);
            if (!sale)
                throw new Error('Sale not found');
            if (sale.status === 'VOIDED')
                throw new Error('Sale is already voided');
            // Restore inventory
            if (sale.items) {
                for (const item of sale.items) {
                    const product = this.productRepo.findById(item.productId);
                    if (product) {
                        const baseQty = item.quantity * item.conversionFactor;
                        const newStock = product.currentStock + baseQty;
                        this.productRepo.updateStock(product.id, newStock);
                        this.productRepo.logStockMovement({
                            productId: product.id,
                            movementType: accounts_1.StockMovementType.SALE_RETURN,
                            quantity: baseQty,
                            previousStock: product.currentStock,
                            newStock,
                            referenceType: 'SALE_VOID',
                            referenceId: sale.id,
                            reason: `Sale ${sale.invoiceNumber} voided`,
                            userId: cashierId
                        });
                    }
                }
            }
            // Revert customer balance if credit was extended
            if (sale.customerId && sale.customerBalanceChange > 0) {
                const customer = this.customerRepo.findById(sale.customerId);
                if (customer) {
                    const newBalance = customer.balance - sale.customerBalanceChange;
                    this.customerRepo.updateBalance(customer.id, newBalance);
                    this.customerRepo.addLedgerEntry({
                        customerId: customer.id,
                        transactionType: 'SALE_VOID',
                        referenceId: sale.id,
                        debit: 0,
                        credit: sale.customerBalanceChange,
                        runningBalance: newBalance,
                        notes: `Voided Invoice ${sale.invoiceNumber}`
                    });
                }
            }
            this.saleRepo.voidSale(id);
        }, targetDb);
    }
}
exports.SalesService = SalesService;
