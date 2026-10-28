import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import { SalesService } from '../../src/application/services/SalesService';
import { PaymentMethod } from '../../src/shared/constants/accounts';

describe('Integration: SQLite Atomic Sale Transaction', () => {
  let db: Database.Database;
  let salesService: SalesService;
  let productRepo: ProductRepository;
  let saleRepo: SaleRepository;
  let customerRepo: CustomerRepository;
  let accountRepo: AccountRepository;

  beforeEach(() => {
    // In-memory SQLite database with foreign keys and WAL mode
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run schema migrations and seeds
    runMigrations(db);

    productRepo = new ProductRepository(db);
    saleRepo = new SaleRepository(db);
    customerRepo = new CustomerRepository(db);
    accountRepo = new AccountRepository(db);

    salesService = new SalesService(saleRepo, productRepo, customerRepo, accountRepo);
  });

  afterEach(() => {
    db.close();
  });

  it('atomically completes sale, reduces stock, logs movement, and creates journal entries', () => {
    // 1. Create a test product with 10 units stock
    const productId = productRepo.create({
      categoryId: 1,
      name: 'Organic Honey 500g',
      sku: 'HONEY-500G',
      barcode: '1234567890123',
      baseUnit: 'Jar',
      costPrice: 40000,   // Rs. 400.00
      sellingPrice: 60000, // Rs. 600.00
      currentStock: 10,
      minStockLevel: 2,
      taxRate: 0,
      isTaxInclusive: true,
      isActive: true
    });

    // 2. Perform a sale of 3 jars (Total: 3 * 600.00 = 1,800.00)
    const sale = salesService.createSale({
      customerId: 1, // Walk-in customer
      cashierId: 1,
      items: [
        {
          productId,
          unitName: 'Jar',
          quantity: 3,
          conversionFactor: 1,
          unitPrice: 60000,
          costPrice: 40000,
          discountPercent: 0,
          discountAmount: 0,
          taxRate: 0,
          isTaxInclusive: true
        }
      ],
      paymentMethod: PaymentMethod.CASH,
      amountPaid: 200000 // Rs. 2,000.00 cash given (Change: Rs. 200.00)
    });

    // 3. Verify Sale Record
    expect(sale).toBeDefined();
    expect(sale.grandTotal).toBe(180000); // 1,800.00
    expect(sale.amountPaid).toBe(200000);
    expect(sale.changeGiven).toBe(20000);  // 200.00 change
    expect(sale.totalCost).toBe(120000);   // 3 * 400.00 = 1,200.00
    expect(sale.profit).toBe(60000);       // 1,800 - 1,200 = 600.00 profit

    // 4. Verify Stock Deduction (10 - 3 = 7 jars remaining)
    const updatedProduct = productRepo.findById(productId);
    expect(updatedProduct?.currentStock).toBe(7);

    // 5. Verify Stock Movement Audit Trail Log
    const movement = db.prepare('SELECT * FROM stock_movements WHERE product_id = ?').get(productId) as any;
    expect(movement).toBeDefined();
    expect(movement.movement_type).toBe('SALE');
    expect(movement.quantity).toBe(3);
    expect(movement.previous_stock).toBe(10);
    expect(movement.new_stock).toBe(7);

    // 6. Verify General Ledger entries created and balanced
    const journal = db.prepare('SELECT * FROM journal_entries WHERE reference_id = ?').get(sale.id) as any;
    expect(journal).toBeDefined();

    const lines = db.prepare('SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?').all(journal.id) as any[];
    const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.credit, 0);

    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits).toBeGreaterThan(0);
  });

  it('rejects sale and aborts transaction when requested stock exceeds inventory', () => {
    const productId = productRepo.create({
      categoryId: 1,
      name: 'Limited Edition Olive Oil',
      sku: 'OLIVE-1L',
      barcode: '998877665544',
      baseUnit: 'Bottle',
      costPrice: 100000,
      sellingPrice: 150000,
      currentStock: 2,
      minStockLevel: 1,
      taxRate: 0,
      isTaxInclusive: true,
      isActive: true
    });

    // Try selling 5 bottles when only 2 exist
    expect(() => {
      salesService.createSale({
        customerId: 1,
        cashierId: 1,
        items: [
          {
            productId,
            unitName: 'Bottle',
            quantity: 5,
            conversionFactor: 1,
            unitPrice: 150000,
            costPrice: 100000,
            discountPercent: 0,
            discountAmount: 0,
            taxRate: 0,
            isTaxInclusive: true
          }
        ],
        paymentMethod: PaymentMethod.CASH,
        amountPaid: 750000
      });
    }).toThrow(/Insufficient stock/);

    // Assert that stock remained untouched at 2
    const product = productRepo.findById(productId);
    expect(product?.currentStock).toBe(2);
  });
});

