import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { StockRules } from '../../domain/inventory/stock-rules';
import { Product, StockAdjustmentRequest } from '../../shared/types';
import { StockMovementType } from '../../shared/constants/accounts';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';

export class InventoryService {
  constructor(private productRepo: ProductRepository = new ProductRepository()) {}

  public listProducts(): Product[] {
    return this.productRepo.list();
  }

  public searchProducts(query: string): Product[] {
    return this.productRepo.search(query);
  }

  public getProductByBarcode(barcode: string): Product | null {
    return this.productRepo.findByBarcode(barcode);
  }

  public saveProduct(product: Omit<Product, 'createdAt' | 'units'>): number {
    if (product.id) {
      const existing = this.productRepo.findById(product.id);
      if (!existing) throw new Error('Product not found');
      this.productRepo.update(product as Product);
      return product.id;
    } else {
      return this.productRepo.create(product);
    }
  }

  public adjustStock(request: StockAdjustmentRequest): number {
    return TransactionRunner.run(() => {
      const product = this.productRepo.findById(request.productId);
      if (!product) throw new Error('Product not found');

      const newStock = StockRules.computeNewStock(
        product.currentStock,
        request.movementType,
        request.quantity
      );

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

  public getLowStockProducts(): Product[] {
    return this.productRepo.listLowStock();
  }

  public listCategories(): Array<{ id: number; name: string; description?: string }> {
    return this.productRepo.listCategories();
  }

  public createCategory(name: string, description?: string): number {
    return this.productRepo.createCategory(name, description);
  }
}

