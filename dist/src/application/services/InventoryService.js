"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const stock_rules_1 = require("../../domain/inventory/stock-rules");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
class InventoryService {
    productRepo;
    constructor(productRepo = new ProductRepository_1.ProductRepository()) {
        this.productRepo = productRepo;
    }
    listProducts() {
        return this.productRepo.list();
    }
    searchProducts(query) {
        return this.productRepo.search(query);
    }
    getProductByBarcode(barcode) {
        return this.productRepo.findByBarcode(barcode);
    }
    saveProduct(product) {
        if (product.id) {
            const existing = this.productRepo.findById(product.id);
            if (!existing)
                throw new Error('Product not found');
            this.productRepo.update(product);
            return product.id;
        }
        else {
            return this.productRepo.create(product);
        }
    }
    adjustStock(request) {
        return transaction_runner_1.TransactionRunner.run(() => {
            const product = this.productRepo.findById(request.productId);
            if (!product)
                throw new Error('Product not found');
            const newStock = stock_rules_1.StockRules.computeNewStock(product.currentStock, request.movementType, request.quantity);
            this.productRepo.updateStock(product.id, newStock);
            this.productRepo.logStockMovement({
                productId: product.id,
                movementType: request.movementType,
                quantity: request.quantity,
                previousStock: product.currentStock,
                newStock,
                referenceType: 'MANUAL_ADJUSTMENT',
                reason: request.reason,
                userId: request.userId
            });
            return newStock;
        });
    }
    getLowStockProducts() {
        return this.productRepo.listLowStock();
    }
    listCategories() {
        return this.productRepo.listCategories();
    }
    createCategory(name, description) {
        return this.productRepo.createCategory(name, description);
    }
}
exports.InventoryService = InventoryService;
