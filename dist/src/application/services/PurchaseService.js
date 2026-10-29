"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseService = void 0;
const PurchaseRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const landed_cost_1 = require("../../domain/purchases/landed-cost");
const stock_location_rules_1 = require("../../domain/inventory/stock-location-rules");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const double_entry_1 = require("../../domain/accounting/double-entry");
const accounts_1 = require("../../shared/constants/accounts");
class PurchaseService {
    purchaseRepo;
    productRepo;
    supplierRepo;
    accountRepo;
    constructor(purchaseRepo = new PurchaseRepository_1.PurchaseRepository(), productRepo = new ProductRepository_1.ProductRepository(), supplierRepo = new SupplierRepository_1.SupplierRepository(), accountRepo = new AccountRepository_1.AccountRepository()) {
        this.purchaseRepo = purchaseRepo;
        this.productRepo = productRepo;
        this.supplierRepo = supplierRepo;
        this.accountRepo = accountRepo;
    }
    createPurchaseOrder(request) {
        if (!request.items || request.items.length === 0) {
            throw new Error('Purchase order must contain at least one item');
        }
        const supplier = this.supplierRepo.findById(request.supplierId);
        if (!supplier)
            throw new Error('Supplier not found');
        if (!supplier.isActive) {
            throw new Error(`Cannot purchase from inactive supplier '${supplier.name}'`);
        }
        const subtotal = request.items.reduce((sum, it) => sum + (it.quantity * it.unitCostPrice), 0);
        const grandTotal = subtotal + request.additionalCost;
        // Landed cost calculations
        const landedResults = landed_cost_1.LandedCostCalculator.calculateLandedCosts(request.items, request.additionalCost);
        return transaction_runner_1.TransactionRunner.run((db) => {
            // Step A0: Resolve and validate Stock Location (Prompt 11)
            let stockLoc = null;
            try {
                if (request.locationId) {
                    stockLoc = db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(String(request.locationId));
                }
                else {
                    stockLoc = db.prepare(`SELECT * FROM stock_locations WHERE is_default = 1 AND is_active = 1 LIMIT 1`).get();
                }
            }
            catch { }
            if (stockLoc) {
                stock_location_rules_1.StockLocationRules.validateReceivable({
                    name: stockLoc.name,
                    isActive: Boolean(stockLoc.is_active),
                    isReceivable: Boolean(stockLoc.is_receivable)
                });
            }
            // 1. Create Purchase Order
            const poId = this.purchaseRepo.create({
                supplierId: request.supplierId,
                invoiceNumber: request.invoiceNumber,
                subtotal,
                additionalCost: request.additionalCost,
                grandTotal,
                amountPaid: request.amountPaid,
                notes: request.notes
            });
            // 2. Insert items and update product stock & cost price
            for (const item of request.items) {
                this.purchaseRepo.createItem(poId, item);
                const product = this.productRepo.findById(item.productId);
                if (product) {
                    const landedInfo = landedResults.find(l => l.productId === item.productId);
                    const effectiveUnitCost = landedInfo ? landedInfo.effectiveUnitCost : item.unitCostPrice;
                    const addedBaseQty = item.quantity * item.conversionFactor;
                    const oldStock = product.currentStock;
                    const newStock = oldStock + addedBaseQty;
                    // Moving average cost calculation
                    let updatedCostPrice = effectiveUnitCost;
                    if (oldStock > 0 && product.costPrice > 0) {
                        const totalValue = (oldStock * product.costPrice) + (addedBaseQty * effectiveUnitCost);
                        updatedCostPrice = Math.round(totalValue / newStock);
                    }
                    // Update product
                    this.productRepo.updateStock(product.id, newStock);
                    this.productRepo.update({
                        ...product,
                        currentStock: newStock,
                        costPrice: updatedCostPrice,
                        sellingPrice: item.sellingPrice > 0 ? item.sellingPrice : product.sellingPrice
                    });
                    if (stockLoc) {
                        const balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(db);
                        balanceRepo.upsertDelta({
                            businessId: stockLoc.business_id,
                            productId: product.id,
                            stockLocationId: stockLoc.id,
                            onHandDeltaScaled: Math.round(addedBaseQty * 1000)
                        });
                    }
                    this.productRepo.logStockMovement({
                        productId: product.id,
                        movementType: accounts_1.StockMovementType.PURCHASE_RECEIPT,
                        quantity: addedBaseQty,
                        previousStock: oldStock,
                        newStock,
                        stockLocationId: stockLoc?.id,
                        referenceType: 'PURCHASE',
                        referenceId: poId,
                        reason: `Purchase receipt #${request.invoiceNumber}`
                    });
                }
            }
            // 3. Update Supplier balance and ledger
            const unpaidBalance = grandTotal - request.amountPaid;
            if (grandTotal > 0) {
                this.supplierRepo.addLedgerEntry({
                    supplierId: supplier.id,
                    entryType: 'PURCHASE_BILL',
                    referenceId: poId,
                    debit: 0,
                    credit: grandTotal,
                    notes: `Bill #${request.invoiceNumber}`
                });
                if (request.amountPaid > 0) {
                    this.supplierRepo.addLedgerEntry({
                        supplierId: supplier.id,
                        entryType: 'PAYMENT_DISBURSED',
                        referenceId: poId,
                        debit: request.amountPaid,
                        credit: 0,
                        notes: `Payment for Bill #${request.invoiceNumber}`
                    });
                }
            }
            // 4. Double Entry posting
            const inventoryAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.INVENTORY_ASSET);
            const payableAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.ACCOUNTS_PAYABLE);
            const cashAccount = this.accountRepo.findByCode(accounts_1.StandardAccountCode.CASH_ON_HAND);
            if (inventoryAccount && payableAccount && cashAccount) {
                const lines = [
                    {
                        accountId: inventoryAccount.id,
                        debit: grandTotal,
                        credit: 0,
                        memo: 'Inventory purchase'
                    }
                ];
                if (request.amountPaid > 0) {
                    lines.push({
                        accountId: cashAccount.id,
                        debit: 0,
                        credit: request.amountPaid,
                        memo: 'Cash paid to supplier'
                    });
                }
                if (unpaidBalance > 0) {
                    lines.push({
                        accountId: payableAccount.id,
                        debit: 0,
                        credit: unpaidBalance,
                        memo: 'Supplier accounts payable'
                    });
                }
                const balanceCheck = double_entry_1.DoubleEntryLedger.validateBalance(lines);
                if (balanceCheck.isBalanced) {
                    this.accountRepo.createJournalEntry({
                        entryNumber: `JE-PO-${request.invoiceNumber}`,
                        referenceType: 'PURCHASE',
                        referenceId: poId,
                        description: `Purchase from ${supplier.name}`,
                        totalAmount: grandTotal,
                        lines
                    });
                    for (const l of lines) {
                        const acc = this.accountRepo.findById(l.accountId);
                        if (acc) {
                            const updatedBal = double_entry_1.DoubleEntryLedger.computeAccountBalance(acc.balance, acc.type, l.debit, l.credit);
                            this.accountRepo.updateBalance(acc.id, updatedBal);
                        }
                    }
                }
            }
            return poId;
        });
    }
    listPurchaseOrders() {
        return this.purchaseRepo.list();
    }
}
exports.PurchaseService = PurchaseService;
