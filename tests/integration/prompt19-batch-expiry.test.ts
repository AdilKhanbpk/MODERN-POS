import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { BatchExpiryService } from '../../src/application/services/BatchExpiryService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { SalesService } from '../../src/application/services/SalesService';
import { StockAdjustmentService } from '../../src/application/services/StockAdjustmentService';
import { StockReservationService } from '../../src/application/services/StockReservationService';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import {
  BatchRequiredError,
  ExpiryDateRequiredError,
  InvalidManufacturingDateError,
  DuplicateBatchNumberError,
  BatchExpiredSaleBlockedError,
  BatchRecalledError,
  BatchQuarantinedError,
  InsufficientBatchStockError,
  BatchAuthorizationRequiredError
} from '../../src/domain/inventory/batch-expiry-rules';
import { BatchExpiryMath } from '../../src/domain/inventory/batch-expiry-math';

describe('Prompt 19 — Batch and Expiry Management Module', () => {
  let db: Database.Database;
  let batchService: BatchExpiryService;
  let catalogService: ProductCatalogService;
  let salesService: SalesService;
  let adjustmentService: StockAdjustmentService;
  let reservationService: StockReservationService;
  let balanceRepo: StockBalanceRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '11111111-1111-1111-1111-111111111111';
  const locWarehouse = '33333333-3333-3333-3333-333333333333';
  const locShopFloor = '44444444-4444-4444-4444-444444444444';
  const supplierId = '77777777-7777-7777-7777-777777777777';
  const actor = { userId: 1, role: 'manager', businessId };

  let unitPieceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    batchService = new BatchExpiryService(db);
    catalogService = new ProductCatalogService(db);
    balanceRepo = new StockBalanceRepository(db);

    salesService = new SalesService();
    (salesService as any).productRepo.db = db;
    (salesService as any).saleRepo.db = db;
    (salesService as any).customerRepo.db = db;
    (salesService as any).accountRepo.db = db;

    adjustmentService = new StockAdjustmentService();
    (adjustmentService as any).getDb = () => db;
    (adjustmentService as any).adjRepo.db = db;
    (adjustmentService as any).locationRepo.db = db;
    (adjustmentService as any).balanceRepo.db = db;
    (adjustmentService as any).productRepo.db = db;

    reservationService = new StockReservationService(db);

    // Seed core enterprise entities
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, name, default_currency, default_cost_method)
      VALUES (?, 'Enterprise Mart', 'PKR', 'fifo')
    `).run(businessId);

    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, name, code)
      VALUES (?, ?, 'Main Branch', 'MAIN')
    `).run(branchId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES 
        ('1', ?, 'admin', 'hash', 'Store Manager', 1),
        ('2', ?, 'cashier', 'hash', 'Counter Cashier', 1)
    `).run(businessId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, name, code, location_type, is_sellable, is_active, is_default)
      VALUES (?, ?, ?, 'Main Warehouse', 'WH-MAIN', 'warehouse', 1, 1, 1)
    `).run(locWarehouse, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, name, code, location_type, is_sellable, is_active, is_default)
      VALUES (?, ?, ?, 'Shop Floor Counter', 'SHOP-01', 'shop_floor', 1, 1, 0)
    `).run(locShopFloor, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, phone, is_active)
      VALUES (?, ?, 'SUP-PHARMA', 'Novartis Pharma Distributors', '03001234567', 1)
    `).run(supplierId, businessId);

    const piece = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as { id: string };
    unitPieceId = piece.id;
  });

  // Helper to create product
  function createProduct(sku: string, name: string, cost = 10000, price = 20000) {
    return catalogService.createProduct({
      businessId,
      sku,
      name,
      barcode: `890${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      baseUnitId: unitPieceId,
      costPrice: cost,
      retailPriceMinor: price
    });
  }

  it('1. Optional module: Ordinary products operate normally without batch configuration', () => {
    const ordinaryProd = createProduct('USB-CABLE-001', 'Braided USB Cable');

    // Add normal stock
    balanceRepo.upsertDelta({
      businessId,
      productId: ordinaryProd.id,
      stockLocationId: locShopFloor,
      onHandDeltaScaled: 10000, // 10 units
      reservedDeltaScaled: 0
    });
    db.prepare('UPDATE products SET current_stock = 10 WHERE id = ?').run(ordinaryProd.id);

    // Ordinary sale succeeds without requiring batch
    const sale = salesService.createSale({
      businessId,
      branchId,
      locationId: locShopFloor,
      cashierId: 1,
      items: [
        {
          productId: ordinaryProd.id,
          quantity: 2,
          conversionFactor: 1,
          unitPrice: 200
        }
      ],
      amountPaid: 400
    });

    expect(sale.id).toBeDefined();
    const updatedProd = db.prepare('SELECT current_stock FROM products WHERE id = ?').get(ordinaryProd.id) as any;
    expect(updatedProd.current_stock).toBe(8); // Reduced from 10 to 8
  });

  it('2. Batch receipt workflow, validation and duplicate prevention', () => {
    const medicine = createProduct('AMOX-500MG', 'Amoxicillin 500mg Capsules');

    // Configure batch & expiry tracking on this medicine
    batchService.configureBatchSettings({
      businessId,
      productId: medicine.id,
      requiresBatch: true,
      requiresExpiry: true,
      expiryWarningDays: 30,
      expirySalePolicy: 'block'
    });

    // Validation: Missing expiry date must be rejected
    expect(() => {
      batchService.receiveBatch({
        businessId,
        branchId,
        stockLocationId: locWarehouse,
        productId: medicine.id,
        batchNumber: 'LOT-AMX-001',
        manufacturingDate: '2026-01-01',
        expiryDate: '', // Empty!
        quantityScaled: 10000,
        unitCostMinor: 5000
      });
    }).toThrow(ExpiryDateRequiredError);

    // Validation: Manufacturing date in future must be rejected
    expect(() => {
      batchService.receiveBatch({
        businessId,
        branchId,
        stockLocationId: locWarehouse,
        productId: medicine.id,
        batchNumber: 'LOT-AMX-001',
        manufacturingDate: '2029-01-01', // Future!
        expiryDate: '2029-12-31',
        quantityScaled: 10000,
        unitCostMinor: 5000
      });
    }).toThrow(InvalidManufacturingDateError);

    // Validation: Manufacturing date after expiry date must be rejected
    expect(() => {
      batchService.receiveBatch({
        businessId,
        branchId,
        stockLocationId: locWarehouse,
        productId: medicine.id,
        batchNumber: 'LOT-AMX-001',
        manufacturingDate: '2026-05-01',
        expiryDate: '2026-04-01', // Before manufacturing!
        quantityScaled: 10000,
        unitCostMinor: 5000
      });
    }).toThrow(InvalidManufacturingDateError);

    // Validation: Already expired stock must be rejected upon receipt
    expect(() => {
      batchService.receiveBatch({
        businessId,
        branchId,
        stockLocationId: locWarehouse,
        productId: medicine.id,
        batchNumber: 'LOT-AMX-001',
        manufacturingDate: '2024-01-01',
        expiryDate: '2025-01-01', // Past date!
        quantityScaled: 10000,
        unitCostMinor: 5000
      });
    }).toThrow(/already expired/);

    // Valid Receipt: 50 units received
    const receipt1 = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locWarehouse,
      productId: medicine.id,
      batchNumber: 'LOT-AMX-001',
      manufacturingDate: '2026-01-15',
      expiryDate: '2028-06-30',
      quantityScaled: 50000, // 50 pcs
      unitCostMinor: 5000,
      supplierId
    });

    expect(receipt1.batch.id).toBeDefined();
    expect(receipt1.batch.status).toBe('active');
    expect(receipt1.balance.onHandScaled).toBe(50000);

    // Verify stock_balances and products table were updated atomically
    const bal = balanceRepo.getBalance(medicine.id, locWarehouse, businessId);
    expect(bal?.onHandScaled).toBe(50000);
    const prodRow = db.prepare('SELECT current_stock FROM products WHERE id = ?').get(medicine.id) as any;
    expect(prodRow.current_stock).toBe(50);

    // Duplicate batch number for same product must be rejected
    expect(() => {
      batchService.receiveBatch({
        businessId,
        branchId,
        stockLocationId: locWarehouse,
        productId: medicine.id,
        batchNumber: 'LOT-AMX-001', // Duplicate!
        manufacturingDate: '2026-01-15',
        expiryDate: '2028-06-30',
        quantityScaled: 20000,
        unitCostMinor: 5000
      });
    }).toThrow(DuplicateBatchNumberError);
  });

  it('3. FEFO stock selection: Sorts eligible batches by earliest expiry and splits multi-batch allocations', () => {
    const syrup = createProduct('COUGH-SYRUP-120ML', 'Pediatric Cough Syrup');

    batchService.configureBatchSettings({
      businessId,
      productId: syrup.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'block'
    });

    // Batch A: Expires first (in 10 days), 5 pieces available
    const bA = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: syrup.id,
      batchNumber: 'BATCH-A-EXP-SOON',
      expiryDate: '2026-11-10',
      quantityScaled: 5000 // 5 pcs
    });

    // Batch B: Expires later (in 40 days), 10 pieces available
    const bB = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: syrup.id,
      batchNumber: 'BATCH-B-EXP-LATER',
      expiryDate: '2026-12-10',
      quantityScaled: 10000 // 10 pcs
    });

    // Batch C: Recalled or Quarantined (must be excluded from FEFO)
    const bC = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: syrup.id,
      batchNumber: 'BATCH-C-DEFECT',
      expiryDate: '2026-11-05', // Expires earliest, but will be quarantined
      quantityScaled: 8000
    });
    batchService.recallBatch({ businessId, batchId: bC.batch.id, reason: 'Packaging seal fault' });

    // Request 8 pieces under FEFO:
    // Prompt specification example:
    // Batch A available: 5 pieces, expires first.
    // Batch B available: 10 pieces, expires later.
    // Sale quantity: 8.
    // Under FEFO:
    // - Allocate 5 from Batch A.
    // - Allocate 3 from Batch B.
    const allocations = batchService.allocateBatchesForSale({
      businessId,
      productId: syrup.id,
      stockLocationId: locShopFloor,
      requestedQuantityScaled: 8000,
      referenceDate: '2026-10-30'
    });

    expect(allocations.length).toBe(2);
    expect(allocations[0].batchNumber).toBe('BATCH-A-EXP-SOON');
    expect(allocations[0].quantityScaled).toBe(5000); // 5 pcs

    expect(allocations[1].batchNumber).toBe('BATCH-B-EXP-LATER');
    expect(allocations[1].quantityScaled).toBe(3000); // 3 pcs

    // Batch C was excluded because it is recalled
    expect(allocations.some((a) => a.batchNumber === 'BATCH-C-DEFECT')).toBe(false);
  });

  it('4. Expiry boundary behaviour: Expired today policy (block vs warn vs allow_authorized)', () => {
    const eyeDrops = createProduct('EYE-DROPS-10ML', 'Sterile Eye Drops');

    // 1. Policy: BLOCK on expiry date
    batchService.configureBatchSettings({
      businessId,
      productId: eyeDrops.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'block'
    });

    const todayBatch = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: eyeDrops.id,
      batchNumber: 'EYE-EXP-TODAY',
      expiryDate: '2026-10-30', // Expires today!
      quantityScaled: 10000
    });

    // Selling today's expiring batch under 'block' throws BatchExpiredSaleBlockedError
    expect(() => {
      batchService.allocateBatchesForSale({
        businessId,
        productId: eyeDrops.id,
        stockLocationId: locShopFloor,
        requestedQuantityScaled: 2000,
        referenceDate: '2026-10-30'
      });
    }).toThrow(BatchExpiredSaleBlockedError);

    // 2. Policy: WARN on expiry date
    batchService.configureBatchSettings({
      businessId,
      productId: eyeDrops.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'warn'
    });

    // Now allocation succeeds
    const warnAllocations = batchService.allocateBatchesForSale({
      businessId,
      productId: eyeDrops.id,
      stockLocationId: locShopFloor,
      requestedQuantityScaled: 2000,
      referenceDate: '2026-10-30'
    });
    expect(warnAllocations.length).toBe(1);

    // 3. Policy: ALLOW_AUTHORIZED
    batchService.configureBatchSettings({
      businessId,
      productId: eyeDrops.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'allow_authorized'
    });

    // Without authorization: rejected with BatchAuthorizationRequiredError
    expect(() => {
      batchService.allocateBatchesForSale({
        businessId,
        productId: eyeDrops.id,
        stockLocationId: locShopFloor,
        requestedQuantityScaled: 2000,
        referenceDate: '2026-10-30',
        isAuthorized: false
      });
    }).toThrow(BatchAuthorizationRequiredError);

    // With authorization: allowed
    const authAllocations = batchService.allocateBatchesForSale({
      businessId,
      productId: eyeDrops.id,
      stockLocationId: locShopFloor,
      requestedQuantityScaled: 2000,
      referenceDate: '2026-10-30',
      isAuthorized: true
    });
    expect(authAllocations.length).toBe(1);
  });

  it('5. Sale workflow: Automatically allocates FEFO batches, decrements batch balances, and records sale_item_batches', () => {
    const paracetamol = createProduct('PARA-500MG', 'Paracetamol Tablets 500mg');

    batchService.configureBatchSettings({
      businessId,
      productId: paracetamol.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'block'
    });

    // Seed Batch 1 (5 pcs, expires 2027-01-01)
    const b1 = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: paracetamol.id,
      batchNumber: 'PARA-LOT-1',
      expiryDate: '2027-01-01',
      quantityScaled: 5000,
      unitCostMinor: 1000
    });

    // Seed Batch 2 (10 pcs, expires 2027-06-01)
    const b2 = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: paracetamol.id,
      batchNumber: 'PARA-LOT-2',
      expiryDate: '2027-06-01',
      quantityScaled: 10000,
      unitCostMinor: 1000
    });

    // Sell 8 units through standard SalesService
    const sale = salesService.createSale({
      businessId,
      branchId,
      locationId: locShopFloor,
      cashierId: 1,
      items: [
        {
          productId: paracetamol.id,
          quantity: 8,
          conversionFactor: 1,
          unitPrice: 2000
        }
      ],
      amountPaid: 16000
    });

    expect(sale.id).toBeDefined();

    // Verify batch stock balance deductions:
    // Batch 1 had 5, allocated 5 -> remaining 0
    const bal1 = batchService.getBatchStockReport(businessId, locShopFloor).find((b) => b.batchId === b1.batch.id);
    expect(bal1?.availableQuantity).toBe(0);

    // Batch 2 had 10, allocated 3 -> remaining 7
    const bal2 = batchService.getBatchStockReport(businessId, locShopFloor).find((b) => b.batchId === b2.batch.id);
    expect(bal2?.availableQuantity).toBe(7);

    // Verify exact batch allocations recorded in sale_item_batches
    const allocationsInDb = db.prepare(`
      SELECT sib.*, pb.batch_number
      FROM sale_item_batches sib
      JOIN product_batches pb ON sib.batch_id = pb.id
      WHERE sib.sale_id = ?
      ORDER BY sib.quantity_scaled DESC
    `).all(String(sale.id)) as any[];

    expect(allocationsInDb.length).toBe(2);
    expect(allocationsInDb[0].batch_number).toBe('PARA-LOT-1');
    expect(allocationsInDb[0].quantity_scaled).toBe(5000); // 5 pcs
    expect(allocationsInDb[1].batch_number).toBe('PARA-LOT-2');
    expect(allocationsInDb[1].quantity_scaled).toBe(3000); // 3 pcs

    // Traceability check: manager can find all sales for Batch 1
    const trace = batchService.getBatchSalesTraceability(b1.batch.id);
    expect(trace.length).toBe(1);
    expect(trace[0].quantitySold).toBe(5);
  });

  it('6. Returns and recalls: Supports return to quarantine vs active, and immediate recall blockage', () => {
    const vaccine = createProduct('VAC-FLU-01', 'Seasonal Flu Vaccine');

    const b = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locShopFloor,
      productId: vaccine.id,
      batchNumber: 'VAC-2026-F1',
      expiryDate: '2027-12-31',
      quantityScaled: 20000
    });

    // Customer returns 2 doses with returnToQuarantine = true (strict cold-chain requirement)
    const returnResult = batchService.customerReturnBatch({
      businessId,
      batchId: b.batch.id,
      stockLocationId: locShopFloor,
      quantityScaled: 2000,
      returnToQuarantine: true,
      reason: 'Cold chain temperature verification required'
    });

    expect(returnResult.newStatus).toBe('quarantine');

    // Quarantined batch cannot be sold!
    expect(() => {
      batchService.allocateBatchesForSale({
        businessId,
        productId: vaccine.id,
        stockLocationId: locShopFloor,
        requestedQuantityScaled: 1000
      });
    }).toThrow(BatchRequiredError);

    // Manager inspects and releases quarantine
    batchService.releaseQuarantineBatch(b.batch.id);

    // Now sellable again
    const allocAfterRelease = batchService.allocateBatchesForSale({
      businessId,
      productId: vaccine.id,
      stockLocationId: locShopFloor,
      requestedQuantityScaled: 1000
    });
    expect(allocAfterRelease.length).toBe(1);

    // Recall Workflow
    const recallResult = batchService.recallBatch({
      businessId,
      batchId: b.batch.id,
      reason: 'Manufacturer recall: vial hairline crack advisory'
    });

    expect(recallResult.remainingStockUnits).toBe(22); // 20 initial + 2 returned = 22

    // Immediate blockage: selling recalled batch throws BatchRecalledError
    expect(() => {
      batchService.allocateBatchesForSale({
        businessId,
        productId: vaccine.id,
        stockLocationId: locShopFloor,
        requestedQuantityScaled: 1000,
        preferredBatchId: b.batch.id
      });
    }).toThrow(BatchRecalledError);
  });

  it('7. Inter-location batch transfer and batch reservation commitment', () => {
    const lotion = createProduct('LOTION-SPF50', 'Sunscreen Lotion SPF 50');

    const b = batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locWarehouse,
      productId: lotion.id,
      batchNumber: 'LOT-SPF-01',
      expiryDate: '2028-01-01',
      quantityScaled: 30000 // 30 units in warehouse
    });

    // 1. Transfer 10 units from Warehouse to Shop Floor
    batchService.transferBatchStock({
      businessId,
      batchId: b.batch.id,
      sourceLocationId: locWarehouse,
      destinationLocationId: locShopFloor,
      quantityScaled: 10000
    });

    const whBal = batchService.getBatchStockReport(businessId, locWarehouse).find((x) => x.batchId === b.batch.id);
    const shopBal = batchService.getBatchStockReport(businessId, locShopFloor).find((x) => x.batchId === b.batch.id);

    expect(whBal?.availableQuantity).toBe(20);
    expect(shopBal?.availableQuantity).toBe(10);

    // 2. Reserve 4 units from this specific batch at Shop Floor
    reservationService.createReservation({
      businessId,
      branchId,
      sourceType: 'sales_order',
      lines: [
        {
          productId: lotion.id,
          stockLocationId: locShopFloor,
          batchId: b.batch.id,
          reservedQuantityScaled: 4000,
          unitId: unitPieceId
        }
      ]
    }, { userId: 1 });

    const shopBalAfterRes = batchService.getBatchStockReport(businessId, locShopFloor).find((x) => x.batchId === b.batch.id);
    expect(shopBalAfterRes?.onHandQuantity).toBe(10);
    expect(shopBalAfterRes?.reservedQuantity).toBe(4);
    expect(shopBalAfterRes?.availableQuantity).toBe(6); // 10 - 4 = 6 available!

    // Over-reservation beyond batch available throws InsufficientBatchStockError
    expect(() => {
      reservationService.createReservation({
        businessId,
        branchId,
        sourceType: 'sales_order',
        lines: [
          {
            productId: lotion.id,
            stockLocationId: locShopFloor,
            batchId: b.batch.id,
            reservedQuantityScaled: 7000, // 7 units > 6 available!
            unitId: unitPieceId
          }
        ]
      }, { userId: 1 });
    }).toThrow(InsufficientBatchStockError);
  });

  it('8. Bypass prevention: Batch-controlled products cannot bypass batch in adjustments or sales', () => {
    const controlledDrug = createProduct('DRUG-CODEINE', 'Controlled Codeine Elixir');

    batchService.configureBatchSettings({
      businessId,
      productId: controlledDrug.id,
      requiresBatch: true,
      requiresExpiry: true
    });

    // 1. Sales Bypass: Selling with 0 batch available must fail with BatchRequiredError
    expect(() => {
      salesService.createSale({
        businessId,
        branchId,
        locationId: locShopFloor,
        cashierId: 1,
        items: [
          {
            productId: controlledDrug.id,
            quantity: 1,
            conversionFactor: 1,
            unitPrice: 5000
          }
        ],
        amountPaid: 5000
      });
    }).toThrow(BatchRequiredError);

    // 2. Adjustment Bypass: Adjusting stock without batchId must fail with BatchRequiredError
    expect(() => {
      adjustmentService.createAdjustment(
        {
          businessId,
          stockLocationId: locWarehouse,
          adjustmentType: 'correction',
          reasonCode: 'DATA_CORRECTION',
          reasonDescription: 'Attempting adjustment without batch',
          lines: [
            {
              productId: controlledDrug.id,
              countedQuantityScaled: 10000,
              systemQuantityScaled: 0
              // batchId omitted!
            }
          ]
        },
        actor
      );
    }).toThrow(BatchRequiredError);
  });

  it('9. Leap year date validation and days remaining computation', () => {
    // Valid leap year Feb 29 (2028 is leap year)
    expect(BatchExpiryMath.isLeapYear(2028)).toBe(true);
    expect(BatchExpiryMath.isLeapYear(2027)).toBe(false);

    const leapDate = BatchExpiryMath.parseDateUtc('2028-02-29');
    expect(leapDate.getUTCFullYear()).toBe(2028);
    expect(leapDate.getUTCMonth()).toBe(1); // February
    expect(leapDate.getUTCDate()).toBe(29);

    // Invalid non-leap year Feb 29 (2027 is not leap year)
    expect(() => {
      BatchExpiryMath.parseDateUtc('2027-02-29');
    }).toThrow(/Invalid calendar date/);

    // Days remaining computation
    const calc = BatchExpiryMath.calculateDaysUntilExpiry('2026-11-10', 30, '2026-10-31');
    expect(calc.daysRemaining).toBe(10);
    expect(calc.isExpiringSoon).toBe(true);
    expect(calc.isExpired).toBe(false);

    const expiredCalc = BatchExpiryMath.calculateDaysUntilExpiry('2026-10-25', 30, '2026-10-31');
    expect(expiredCalc.daysRemaining).toBe(-6);
    expect(expiredCalc.isExpired).toBe(true);
  });

  it('10. Persistence across application restart and report valuation calculations', () => {
    const cosmetic = createProduct('SERUM-VIT-C', 'Vitamin C Brightening Serum', 250000, 450000);

    batchService.configureBatchSettings({
      businessId,
      productId: cosmetic.id,
      requiresBatch: true,
      requiresExpiry: true,
      expirySalePolicy: 'warn'
    });

    batchService.receiveBatch({
      businessId,
      branchId,
      stockLocationId: locWarehouse,
      productId: cosmetic.id,
      batchNumber: 'SERUM-LOT-99',
      expiryDate: '2028-05-31',
      quantityScaled: 15000, // 15 units
      unitCostMinor: 250000 // Rs. 2500 per unit
    });

    // Verify batch valuation report
    const valReport = batchService.getBatchValuationReport(businessId, locWarehouse);
    const item = valReport.items.find((x) => x.productId === cosmetic.id);
    expect(item).toBeDefined();
    expect(item?.onHandQuantity).toBe(15);
    expect(item?.totalValuationMinor).toBe(15 * 250000); // 3,750,000 minor units (Rs. 37,500)

    // Reopen service with same db to simulate app restart
    const restartedService = new BatchExpiryService(db);
    const settings = restartedService.getBatchSettings(cosmetic.id, businessId);
    expect(settings).not.toBeNull();
    expect(settings?.requiresBatch).toBe(true);
    expect(settings?.expirySalePolicy).toBe('warn');

    const reportAfterRestart = restartedService.getBatchStockReport(businessId, locWarehouse);
    const batchAfterRestart = reportAfterRestart.find((x) => x.productId === cosmetic.id);
    expect(batchAfterRestart?.batchNumber).toBe('SERUM-LOT-99');
    expect(batchAfterRestart?.availableQuantity).toBe(15);
  });
});
