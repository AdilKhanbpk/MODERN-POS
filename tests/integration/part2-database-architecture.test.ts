import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockRepository } from '../../src/infrastructure/sqlite/repositories/StockRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import { PaymentRepository } from '../../src/infrastructure/sqlite/repositories/PaymentRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { SequenceRepository } from '../../src/infrastructure/sqlite/repositories/SequenceRepository';
import { IdempotencyRepository } from '../../src/infrastructure/sqlite/repositories/IdempotencyRepository';
import { StockMovementType } from '../../src/shared/constants/accounts';

describe('PART 2 — Complete Database Architecture & Relational Rules', () => {
  let db: Database.Database;
  let productRepo: ProductRepository;
  let stockRepo: StockRepository;
  let customerRepo: CustomerRepository;
  let supplierRepo: SupplierRepository;
  let paymentRepo: PaymentRepository;
  let saleRepo: SaleRepository;
  let sequenceRepo: SequenceRepository;
  let idempotencyRepo: IdempotencyRepository;

  beforeEach(() => {
    // In-memory SQLite with foreign key enforcement
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run versioned migrations (V1 and V2)
    runMigrations(db);

    productRepo = new ProductRepository(db);
    stockRepo = new StockRepository(db);
    customerRepo = new CustomerRepository(db);
    supplierRepo = new SupplierRepository(db);
    paymentRepo = new PaymentRepository(db);
    saleRepo = new SaleRepository(db);
    sequenceRepo = new SequenceRepository(db);
    idempotencyRepo = new IdempotencyRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('RULE: Foreign keys enforce ON DELETE RESTRICT on posted financial records', () => {
    // Create customer and product
    const customerId = customerRepo.create({
      name: 'Tariq Mehmood',
      phone: '03009988776',
      creditLimitMinor: 500000
    });

    const productId = productRepo.create({
      name: 'Basmati Rice 5kg',
      sku: 'RICE-5KG',
      barcode: '8901234567890',
      sellingPrice: 120000,
      costPrice: 90000
    });

    // Create a posted sale
    const saleId = saleRepo.create({
      invoiceNumber: 'INV-TEST-001',
      customerId,
      cashierId: 1,
      subtotal: 120000,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: 120000,
      totalCost: 90000,
      profit: 30000,
      paymentMethod: 'CASH',
      amountPaid: 120000,
      changeGiven: 0,
      customerBalanceChange: 0
    });

    saleRepo.createItem({
      saleId,
      productId,
      productName: 'Basmati Rice 5kg',
      productBarcode: '8901234567890',
      unitName: 'Bag',
      quantity: 1,
      conversionFactor: 1,
      unitPrice: 120000,
      costPrice: 90000,
      lineDiscount: 0,
      lineTax: 0,
      lineTotal: 120000,
      lineProfit: 30000
    });

    // Attempting to delete a customer who has a posted financial sale must FAIL due to foreign key RESTRICT!
    expect(() => {
      db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Attempting to delete a product that has been sold in posted sale lines must FAIL!
    expect(() => {
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('RULE: Product-specific packaging unit conversions (Shampoo 6-pack vs Juice 12-pack)', () => {
    // Pack unit id is 3 (seeded in units)
    const shampooId = productRepo.create({
      name: 'Anti-Dandruff Shampoo 400ml',
      sku: 'SHAMP-400',
      barcode: '111222333',
      sellingPrice: 65000,
      costPrice: 50000
    });

    const juiceId = productRepo.create({
      name: 'Orange Juice 1L',
      sku: 'JUICE-1L',
      barcode: '444555666',
      sellingPrice: 30000,
      costPrice: 22000
    });

    // Shampoo pack size is 6 pieces (6 numerator, 1 denominator)
    productRepo.setUnitConversion(shampooId, 3, 6, 1);

    // Juice pack size is 12 pieces (12 numerator, 1 denominator)
    productRepo.setUnitConversion(juiceId, 3, 12, 1);

    // Verify shampoo conversions
    const shampooConversions = productRepo.getProductUnitConversions(shampooId);
    expect(shampooConversions.length).toBe(1);
    expect(shampooConversions[0].baseUnitsNumerator).toBe(6);

    // Verify juice conversions
    const juiceConversions = productRepo.getProductUnitConversions(juiceId);
    expect(juiceConversions.length).toBe(1);
    expect(juiceConversions[0].baseUnitsNumerator).toBe(12);
  });

  it('RULE: Multiple barcodes per product and variant', () => {
    const shirtId = productRepo.create({
      name: 'Cotton Polo Shirt',
      sku: 'SHIRT-POLO',
      barcode: '1000000001',
      sellingPrice: 150000,
      costPrice: 80000
    });

    // Add variant Medium and Large
    const varMediumId = productRepo.addVariant({
      productId: shirtId,
      variantSku: 'SHIRT-POLO-M',
      size: 'M',
      color: 'Navy Blue'
    });

    const varLargeId = productRepo.addVariant({
      productId: shirtId,
      variantSku: 'SHIRT-POLO-L',
      size: 'L',
      color: 'Navy Blue'
    });

    // Add distinct barcodes for each variant
    productRepo.addBarcode(shirtId, 'BAR-POLO-MED', 1, varMediumId);
    productRepo.addBarcode(shirtId, 'BAR-POLO-LRG', 1, varLargeId);

    // Lookup by variant barcode
    const foundMedium = productRepo.findByBarcode('BAR-POLO-MED');
    expect(foundMedium).toBeDefined();
    expect(foundMedium?.id).toBe(shirtId);
    expect(foundMedium?.variants?.length).toBe(2);
  });

  it('RULE: Stock movements permanent audit & stock balances transactional projection', () => {
    const prodId = productRepo.create({
      name: 'Cooking Oil 5L',
      sku: 'OIL-5L',
      barcode: '7788990011',
      currentStock: 0
    });

    // 1. Initial intake: +20 units at location 1
    stockRepo.recordMovement({
      productId: prodId,
      locationId: 1,
      movementType: StockMovementType.PURCHASE_RECEIPT,
      quantityBaseScaled: 20,
      sourceType: 'PURCHASE',
      sourceId: 101,
      reason: 'Purchase receipt PO-101'
    });

    expect(stockRepo.getStockBalance(prodId, 1)).toBe(20);

    // 2. Retail sale: -3 units at location 1
    stockRepo.recordMovement({
      productId: prodId,
      locationId: 1,
      movementType: StockMovementType.SALE,
      quantityBaseScaled: -3,
      sourceType: 'SALE',
      sourceId: 201,
      reason: 'Sale invoice INV-201'
    });

    expect(stockRepo.getStockBalance(prodId, 1)).toBe(17);

    // 3. Reconcile check: sum(movements) === stock_balances projection
    const recon = stockRepo.reconcileStock(prodId, 1);
    expect(recon.isReconciled).toBe(true);
    expect(recon.difference).toBe(0);
    expect(recon.calculatedFromMovements).toBe(17);
    expect(recon.projectedInBalance).toBe(17);
  });

  it('RULE: Payments and Payment Allocations with Multiple Invoices', () => {
    const custId = customerRepo.create({
      name: 'Bilal Super Store',
      phone: '03112233445',
      creditLimitMinor: 1000000
    });

    // Customer makes a lump sum payment of Rs. 5,000 (500,000 minor)
    // Applied across two invoices: Rs. 2,000 on Bill 1, and Rs. 3,000 on Bill 2
    const paymentId = paymentRepo.createPaymentWithAllocations({
      paymentNumber: 'PAY-2026-0001',
      partyType: 'CUSTOMER',
      partyId: custId,
      direction: 'INBOUND',
      amountMinor: 500000, // Rs. 5,000
      paymentMethodId: 1,   // Cash
      notes: 'Lump-sum payment for Bill #1 and Bill #2',
      createdBy: 1,
      allocations: [
        { documentType: 'SALE', documentId: 1001, amountMinor: 200000 }, // Rs. 2,000
        { documentType: 'SALE', documentId: 1002, amountMinor: 300000 }  // Rs. 3,000
      ]
    });

    const payment = paymentRepo.getPaymentById(paymentId);
    expect(payment).toBeDefined();
    expect(payment?.amountMinor).toBe(500000);
    expect(payment?.allocations?.length).toBe(2);
    expect(payment?.allocations?.[0].amountMinor).toBe(200000);
    expect(payment?.allocations?.[1].amountMinor).toBe(300000);
  });

  it('RULE: Cash session drawer tracking (Cash affects drawer vs Bank/Easypaisa does not)', () => {
    // Open a cash session with Rs. 10,000 opening float
    const sessionId = paymentRepo.openCashSession(1, 1, 1000000);

    // 1. Inbound Cash payment of Rs. 3,000 (Method 1: Cash, affects_cash_drawer = 1)
    paymentRepo.createPaymentWithAllocations({
      paymentNumber: 'PAY-CASH-1',
      partyType: 'CUSTOMER',
      direction: 'INBOUND',
      amountMinor: 300000,
      paymentMethodId: 1, // Cash -> affects drawer!
      cashSessionId: sessionId,
      createdBy: 1,
      allocations: [{ documentType: 'SALE', documentId: 501, amountMinor: 300000 }]
    });

    // 2. Inbound Bank / Easypaisa payment of Rs. 7,000 (Method 4: Easypaisa, affects_cash_drawer = 0)
    paymentRepo.createPaymentWithAllocations({
      paymentNumber: 'PAY-EASY-1',
      partyType: 'CUSTOMER',
      direction: 'INBOUND',
      amountMinor: 700000,
      paymentMethodId: 4, // Easypaisa -> does NOT affect drawer cash!
      cashSessionId: sessionId,
      createdBy: 1,
      allocations: [{ documentType: 'SALE', documentId: 502, amountMinor: 700000 }]
    });

    // Close session and count physical cash: 10,000 opening + 3,000 cash = 13,000 expected cash
    // Physical cash counted = 13,000 (1,300,000 minor)
    const closedSession = paymentRepo.closeCashSession(sessionId, 1, 1300000);
    expect(closedSession.status).toBe('CLOSED');
    expect(closedSession.expectedCashMinor).toBe(1300000);
    expect(closedSession.countedCashMinor).toBe(1300000);
    expect(closedSession.differenceMinor).toBe(0); // Perfect balance!
  });

  it('RULE: Customer ledger balance calculation & dated opening balance', () => {
    // Create customer with dated opening balance of Rs. 1,500 (150,000 minor)
    const custId = customerRepo.create({
      name: 'Chaudhry Traders',
      phone: '03451122334',
      openingBalanceMinor: 150000
    });

    // Ledger balance should immediately reflect the 150,000 opening balance
    expect(customerRepo.calculateLedgerBalance(custId)).toBe(150000);
    expect(customerRepo.reconcileBalance(custId).isReconciled).toBe(true);

    // Bill on credit: +Rs. 3,500
    customerRepo.addLedgerEntry({
      customerId: custId,
      entryType: 'SALE_INVOICE',
      debitMinor: 350000,
      creditMinor: 0,
      sourceType: 'SALE',
      sourceId: 888,
      notes: 'Invoice #INV-888'
    });

    expect(customerRepo.calculateLedgerBalance(custId)).toBe(500000); // 1,500 + 3,500 = 5,000

    // Payment received: -Rs. 2,000
    customerRepo.addLedgerEntry({
      customerId: custId,
      entryType: 'PAYMENT_RECEIVED',
      debitMinor: 0,
      creditMinor: 200000,
      sourceType: 'PAYMENT',
      sourceId: 999,
      notes: 'Cash payment'
    });

    // 5,000 - 2,000 = 3,000 (300,000 minor)
    expect(customerRepo.calculateLedgerBalance(custId)).toBe(300000);
    expect(customerRepo.reconcileBalance(custId).isReconciled).toBe(true);
  });

  it('RULE: Sale lines preserve historical snapshots (Name, SKU, Price, Cost)', () => {
    const prodId = productRepo.create({
      name: 'Original Biscuit Pack 100g',
      sku: 'BISC-100',
      barcode: '5566778899',
      sellingPrice: 5000, // Rs. 50.00
      costPrice: 3500    // Rs. 35.00
    });

    const saleId = saleRepo.create({
      invoiceNumber: 'INV-HIST-001',
      cashierId: 1,
      subtotal: 5000,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: 5000,
      totalCost: 3500,
      profit: 1500,
      paymentMethod: 'CASH',
      amountPaid: 5000,
      changeGiven: 0,
      customerBalanceChange: 0
    });

    saleRepo.createItem({
      saleId,
      productId: prodId,
      productName: 'Original Biscuit Pack 100g',
      productSku: 'BISC-100',
      productBarcode: '5566778899',
      unitName: 'Piece',
      quantity: 1,
      conversionFactor: 1,
      unitPrice: 5000,
      costPrice: 3500,
      lineDiscount: 0,
      lineTax: 0,
      lineTotal: 5000,
      lineProfit: 1500
    });

    // Now, change the product name and price in the master catalog later!
    const product = productRepo.findById(prodId)!;
    productRepo.update({
      ...product,
      name: 'New Rebranded Luxury Biscuit 100g',
      sellingPrice: 8000 // Price raised to Rs. 80.00
    });

    // The historical sale bill MUST retain the original name and price snapshot!
    const sale = saleRepo.findById(saleId)!;
    expect(sale.lines).toBeDefined();
    expect(sale.lines?.[0].productNameSnapshot).toBe('Original Biscuit Pack 100g');
    expect(sale.lines?.[0].unitPriceMinor).toBe(5000);
    expect(sale.lines?.[0].lineTotalMinor).toBe(5000);
  });

  it('RULE: Idempotency key prevents double-posting of transactions', () => {
    const key = 'IDEMPOTENT-SALE-UUID-12345';

    // First attempt: key does not exist
    expect(idempotencyRepo.findKey(key)).toBeNull();

    // Process and save operation key
    const responseData = { success: true, invoiceNumber: 'INV-1001', total: 5000 };
    idempotencyRepo.saveKey(key, 'POST_SALE', responseData);

    // Second attempt (e.g. double-click by user or network retry): key exists!
    const existing = idempotencyRepo.findKey(key);
    expect(existing).toBeDefined();
    expect(JSON.parse(existing!.responsePayload).invoiceNumber).toBe('INV-1001');
  });

  it('RULE: Document sequences generate sequential numbering atomically', () => {
    const inv1 = sequenceRepo.getNextSequence('SALE');
    const inv2 = sequenceRepo.getNextSequence('SALE');
    const inv3 = sequenceRepo.getNextSequence('SALE');

    expect(inv1).toBe('INV-1001');
    expect(inv2).toBe('INV-1002');
    expect(inv3).toBe('INV-1003');

    const po1 = sequenceRepo.getNextSequence('PURCHASE');
    const po2 = sequenceRepo.getNextSequence('PURCHASE');
    expect(po1).toBe('PO-2001');
    expect(po2).toBe('PO-2002');
  });
});

