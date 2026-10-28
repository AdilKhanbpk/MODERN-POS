"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseService = void 0;
const PurchaseRepository_1 = require("../../infrastructure/sqlite/repositories/PurchaseRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const landed_cost_1 = require("../../domain/purchases/landed-cost");
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
        const subtotal = request.items.reduce((sum, it) => sum + (it.quantity * it.unitCostPrice), 0);
        const grandTotal = subtotal + request.additionalCost;
        // Landed cost calculations
        const landedResults = landed_cost_1.LandedCostCalculator.calculateLandedCosts(request.items, request.additionalCost);
        return transaction_runner_1.TransactionRunner.run((db) => {
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
                    this.productRepo.logStockMovement({
                        productId: product.id,
                        movementType: accounts_1.StockMovementType.PURCHASE_RECEIPT,
                        quantity: addedBaseQty,
                        previousStock: oldStock,
                        newStock,
                        referenceType: 'PURCHASE',
                        referenceId: poId,
                        reason: `Purchase receipt #${request.invoiceNumber}`
                    });
                }
            }
            // 3. Update Supplier balance and ledger
            const unpaidBalance = grandTotal - request.amountPaid;
            if (unpaidBalance > 0) {
                const newBalance = supplier.balance + unpaidBalance;
                this.supplierRepo.updateBalance(supplier.id, newBalance);
                this.supplierRepo.addLedgerEntry({
                    supplierId: supplier.id,
                    transactionType: 'PURCHASE_BILL',
                    referenceId: poId,
                    debit: 0,
                    credit: unpaidBalance,
                    runningBalance: newBalance,
                    notes: `Bill #${request.invoiceNumber}`
                });
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
