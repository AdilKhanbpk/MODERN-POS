import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { SerialTrackingService } from '../../src/application/services/SerialTrackingService';
import { SalesService } from '../../src/application/services/SalesService';
import { StockAdjustmentService } from '../../src/application/services/StockAdjustmentService';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { SerialRepository } from '../../src/infrastructure/sqlite/repositories/SerialRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import { Permission, Role } from '../../src/shared/constants/roles-permissions';
import {
  SerialRequiredError,
  SerialCountMismatchError,
  DuplicateSerialNumberError,
  DuplicateImeiError,
  SerialAlreadySoldError,
  SerialNotAvailableError,
  ManualSerialEntryNotAllowedError,
  UnauthorizedReturnError
} from '../../src/domain/inventory/serial-rules';

describe('Prompt 20 — Serial-Number & IMEI Tracking Module', () => {
  let db: Database.Database;
  let serialService: SerialTrackingService;
  let salesService: SalesService;
  let adjustmentService: StockAdjustmentService;
  let productRepo: ProductRepository;
  let balanceRepo: StockBalanceRepository;
  let serialRepo: SerialRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const locWarehouse = '00000000-0000-0000-0000-000000000003';
  const locShopFloor = '00000000-0000-0000-0000-000000000004';
  const supplierId = '00000000-0000-0000-0000-000000000005';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    serialService = new SerialTrackingService(db);
    salesService = new SalesService(
      new SaleRepository(db),
      new ProductRepository(db),
      new CustomerRepository(db),
      new AccountRepository(db)
    );
    adjustmentService = new StockAdjustmentService();
    (adjustmentService as any).getDb = () => db;
    (adjustmentService as any).adjRepo.db = db;
    (adjustmentService as any).locationRepo.db = db;
    (adjustmentService as any).balanceRepo.db = db;
    (adjustmentService as any).productRepo.db = db;
    productRepo = new ProductRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    serialRepo = new SerialRepository(db);

    // Seed test branch & locations
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, code, name, is_active)
      VALUES (?, ?, 'BR-MAIN', 'Main Store Branch', 1)
    `).run(branchId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-WH', 'Central Warehouse', 'warehouse', 1)
    `).run(locWarehouse, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, code, name, location_type, is_default, is_active)
      VALUES (?, ?, ?, 'LOC-SHOP', 'Sales Floor', 'shop_floor', 1, 1)
    `).run(locShopFloor, businessId, branchId);

    // Seed test supplier
    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active)
      VALUES (?, ?, 'SUPP-TECH', 'Tech Distributors Global', 1)
    `).run(supplierId, businessId);
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // TEST 1: STRICTLY OPTIONAL ARCHITECTURE
  // =========================================================================
  it('1. Operates normally without serial configuration for ordinary quantity-based products', () => {
    const prodId = productRepo.create({
      name: 'Ordinary USB Cable',
      sku: 'SKU-USB-01',
      barcode: 'BAR-USB-01',
      categoryId: 1,
      costPrice: 500,
      sellingPrice: 1000,
      currentStock: 20
    });

    balanceRepo.upsertDelta({
      businessId,
      productId: prodId,
      stockLocationId: locShopFloor,
      onHandDeltaScaled: 20000
    });

    // Make an ordinary sale without specifying serials
    const sale = salesService.createSale({
      businessId,
      cashierId: 1,
      items: [
        {
          productId: prodId,
          quantity: 3,
          conversionFactor: 1,
          unitPrice: 1000
        }
      ],
      amountPaid: 3000
    });

    expect(sale).toBeDefined();
    expect(sale.grandTotal).toBe(3000);

    const updatedProd = productRepo.findById(prodId);
    expect(updatedProd?.currentStock).toBe(17);

    // Zero serial entries should exist
    const serialCount = db.prepare('SELECT COUNT(*) as count FROM product_serial_numbers WHERE product_id = ?').get(String(prodId)) as any;
    expect(serialCount.count).toBe(0);
  });

  // =========================================================================
  // TEST 2: PURCHASE RECEIVING & EXACT COUNT MATCHING
  // =========================================================================
  it('2. Enforces exact serial count matching received quantity during purchase receiving', () => {
    const prodId = productRepo.create({
      name: 'Pro Laptop 15-inch',
      sku: 'SKU-LAPTOP-15',
      barcode: 'BAR-LAPTOP-15',
      categoryId: 1,
      costPrice: 80000,
      sellingPrice: 120000,
      currentStock: 0
    });

    // Configure serial tracking
    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      warrantyDefaultMonths: 24,
      allowManualSerialEntry: true
    });

    // Attempting to receive 5 units with only 4 serials must throw SerialCountMismatchError
    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locWarehouse,
        supplierId,
        quantityScaled: 5000, // 5 units
        unitCostMinor: 8000000,
        serials: [
          { serialNumber: 'SN-LAP-001' },
          { serialNumber: 'SN-LAP-002' },
          { serialNumber: 'SN-LAP-003' },
          { serialNumber: 'SN-LAP-004' }
        ]
      });
    }).toThrow(SerialCountMismatchError);

    // Correct payload with exactly 5 serials
    const receipt = serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locWarehouse,
      supplierId,
      quantityScaled: 5000,
      unitCostMinor: 8000000,
      serials: [
        { serialNumber: 'SN-LAP-001' },
        { serialNumber: 'SN-LAP-002' },
        { serialNumber: 'SN-LAP-003' },
        { serialNumber: 'SN-LAP-004' },
        { serialNumber: 'SN-LAP-005' }
      ]
    });

    expect(receipt.totalCount).toBe(5);
    expect(receipt.receivedSerials.length).toBe(5);

    // Verify database balances and records
    const prod = productRepo.findById(prodId);
    expect(prod?.currentStock).toBe(5);

    const bal = balanceRepo.getBalance(prodId, locWarehouse, businessId);
    expect(bal?.onHandScaled).toBe(5000);

    const historyEvents = db.prepare('SELECT * FROM serial_number_history WHERE event_type = ?').all('PURCHASE_RECEIPT') as any[];
    expect(historyEvents.length).toBe(5);
  });

  // =========================================================================
  // TEST 3: DUPLICATE DETECTION (BATCH & DATABASE)
  // =========================================================================
  it('3. Rejects duplicate serial numbers within receipt payload and across the database', () => {
    const prodId = productRepo.create({
      name: 'High Precision Lab Scale',
      sku: 'SKU-LAB-SCALE',
      barcode: 'BAR-LAB-SCALE',
      categoryId: 1,
      costPrice: 50000,
      sellingPrice: 75000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true
    });

    // Duplicate within same payload
    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locWarehouse,
        quantityScaled: 2000,
        serials: [
          { serialNumber: 'SN-SCALE-100' },
          { serialNumber: 'SN-SCALE-100' } // Duplicate!
        ]
      });
    }).toThrow(DuplicateSerialNumberError);

    // First successful receipt
    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locWarehouse,
      quantityScaled: 1000,
      serials: [{ serialNumber: 'SN-SCALE-100' }]
    });

    // Attempting to receive identical serial again in another receipt
    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locWarehouse,
        quantityScaled: 1000,
        serials: [{ serialNumber: 'SN-SCALE-100' }]
      });
    }).toThrow(DuplicateSerialNumberError);
  });

  // =========================================================================
  // TEST 4: IMEI LUHN CHECKSUM & DUPLICATE IMEI VALIDATION
  // =========================================================================
  it('4. Validates IMEI Modulo-10 Luhn checksum and prevents duplicate IMEIs', () => {
    const prodId = productRepo.create({
      name: 'Flagship Smartphone 5G',
      sku: 'SKU-PHONE-5G',
      barcode: 'BAR-PHONE-5G',
      categoryId: 1,
      costPrice: 60000,
      sellingPrice: 90000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      serialFormatRule: {
        validateImeiLuhn: true
      }
    });

    // Invalid Luhn checksum (last digit should be 3 for 86012345678901, test with 9)
    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locShopFloor,
        quantityScaled: 1000,
        serials: [{ serialNumber: 'SN-PH-01', imei1: '860123456789019' }]
      });
    }).toThrow(/Invalid IMEI Luhn check digit/);

    // Valid IMEI: 860123456789014 (Luhn valid)
    const validReceipt = serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locShopFloor,
      quantityScaled: 1000,
      serials: [{ serialNumber: 'SN-PH-01', imei1: '860123456789014' }]
    });
    expect(validReceipt.totalCount).toBe(1);

    // Duplicate IMEI validation
    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locShopFloor,
        quantityScaled: 1000,
        serials: [{ serialNumber: 'SN-PH-02', imei1: '860123456789014' }]
      });
    }).toThrow(DuplicateImeiError);
  });

  // =========================================================================
  // TEST 5: SALE WORKFLOW & AUTOMATIC WARRANTY CREATION
  // =========================================================================
  it('5. Allocates serials on sale, transitions status to sold, and registers warranty', () => {
    const prodId = productRepo.create({
      name: 'Ultrabook 14',
      sku: 'SKU-ULTRA-14',
      barcode: 'BAR-ULTRA-14',
      categoryId: 1,
      costPrice: 70000,
      sellingPrice: 105000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      warrantyDefaultMonths: 12
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locShopFloor,
      quantityScaled: 3000,
      serials: [
        { serialNumber: 'SN-UB-001' },
        { serialNumber: 'SN-UB-002' },
        { serialNumber: 'SN-UB-003' }
      ]
    });

    // Sell 2 units specifying serials
    const sale = salesService.createSale({
      businessId,
      cashierId: 1,
      items: [
        {
          productId: prodId,
          quantity: 2,
          conversionFactor: 1,
          unitPrice: 105000,
          serialNumbers: ['SN-UB-001', 'SN-UB-002']
        }
      ],
      amountPaid: 210000
    });

    expect(sale).toBeDefined();

    // Verify serial status in database
    const s1 = serialRepo.findBySerialNumber(businessId, prodId, 'SN-UB-001');
    const s2 = serialRepo.findBySerialNumber(businessId, prodId, 'SN-UB-002');
    const s3 = serialRepo.findBySerialNumber(businessId, prodId, 'SN-UB-003');

    expect(s1?.status).toBe('sold');
    expect(s1?.soldAt).toBeDefined();
    expect(s2?.status).toBe('sold');
    expect(s3?.status).toBe('in_stock');

    // Verify sale_item_serials link
    const itemSerials = serialRepo.getSaleItemSerials(String(sale.id));
    expect(itemSerials.length).toBe(2);

    // Verify warranty registration
    const warranty1 = serialRepo.getWarrantyForSerial(s1!.id);
    expect(warranty1).toBeDefined();
    expect(warranty1?.warrantyTerms).toContain('12 months');
  });

  // =========================================================================
  // TEST 6: MULTI-COUNTER CONCURRENCY & RACE CONFLICT PREVENTION
  // =========================================================================
  it('6. Strictly prevents selling the same serial twice across simultaneous counters', () => {
    const prodId = productRepo.create({
      name: 'Gaming Console Elite',
      sku: 'SKU-CONSOLE',
      barcode: 'BAR-CONSOLE',
      categoryId: 1,
      costPrice: 40000,
      sellingPrice: 60000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locShopFloor,
      quantityScaled: 2000,
      serials: [
        { serialNumber: 'SN-CONSOLE-99' },
        { serialNumber: 'SN-CONSOLE-100' }
      ]
    });

    // Counter 1 successfully sells the serial
    const sale1 = salesService.createSale({
      businessId,
      locationId: locShopFloor,
      cashierId: 1,
      items: [
        {
          productId: prodId,
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 60000,
          serialNumbers: ['SN-CONSOLE-99']
        }
      ],
      amountPaid: 60000
    });
    expect(sale1).toBeDefined();

    // Counter 2 attempts to sell the same serial simultaneously
    expect(() => {
      salesService.createSale({
        businessId,
        locationId: locShopFloor,
        cashierId: 2,
        items: [
          {
            productId: prodId,
            quantity: 1,
            conversionFactor: 1,
            unitPrice: 60000,
            serialNumbers: ['SN-CONSOLE-99']
          }
        ],
        amountPaid: 60000
      });
    }).toThrow(SerialAlreadySoldError);
  });

  // =========================================================================
  // TEST 7: ANTI-BYPASS GUARDS (SALES & STOCK ADJUSTMENTS)
  // =========================================================================
  it('7. Enforces anti-bypass guards: serial-tracked products cannot skip serial validation', () => {
    const prodId = productRepo.create({
      name: 'Industrial Generator 10kVA',
      sku: 'SKU-GEN-10K',
      barcode: 'BAR-GEN-10K',
      categoryId: 1,
      costPrice: 200000,
      sellingPrice: 300000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locWarehouse,
      quantityScaled: 1000,
      serials: [{ serialNumber: 'SN-GEN-001' }]
    });

    // Bypass attempt A: Sale without serialNumbers array
    expect(() => {
      salesService.createSale({
        businessId,
        locationId: locWarehouse,
        cashierId: 1,
        items: [
          {
            productId: prodId,
            quantity: 1,
            conversionFactor: 1,
            unitPrice: 300000
          }
        ],
        amountPaid: 300000
      });
    }).toThrow(SerialRequiredError);

    // Bypass attempt B: Stock adjustment without serialNumber
    expect(() => {
      adjustmentService.createAdjustment({
        businessId,
        stockLocationId: locWarehouse,
        adjustmentType: 'decrease',
        reasonCode: 'DAMAGED',
        reasonDescription: 'Forklift impact',
        lines: [
          {
            productId: prodId,
            countedQuantityScaled: 0
            // No serialNumber specified
          }
        ]
      }, { userId: '1', businessId, role: 'MANAGER' });
    }).toThrow(SerialRequiredError);
  });

  // =========================================================================
  // TEST 8: CUSTOMER RETURNS & MANAGER OVERRIDE
  // =========================================================================
  it('8. Handles customer returns: working vs damaged vs inspection and manager approval', () => {
    const prodId = productRepo.create({
      name: 'Wireless Tablet 11-inch',
      sku: 'SKU-TAB-11',
      barcode: 'BAR-TAB-11',
      categoryId: 1,
      costPrice: 35000,
      sellingPrice: 50000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locShopFloor,
      quantityScaled: 2000,
      serials: [
        { serialNumber: 'SN-TAB-01' },
        { serialNumber: 'SN-TAB-02' }
      ]
    });

    // Sell both units
    salesService.createSale({
      businessId,
      cashierId: 1,
      items: [
        {
          productId: prodId,
          quantity: 2,
          conversionFactor: 1,
          unitPrice: 50000,
          serialNumbers: ['SN-TAB-01', 'SN-TAB-02']
        }
      ],
      amountPaid: 100000
    });

    // Case A: Return without receipt and without manager approval must fail
    expect(() => {
      serialService.processCustomerReturn({
        businessId,
        serialNumber: 'SN-TAB-01',
        condition: 'working',
        hasOriginalReceipt: false,
        managerApproved: false,
        reason: 'Customer lost receipt'
      });
    }).toThrow(UnauthorizedReturnError);

    // Case B: Return with manager approval -> working condition restores to in_stock
    const returnWorking = serialService.processCustomerReturn({
      businessId,
      serialNumber: 'SN-TAB-01',
      condition: 'working',
      hasOriginalReceipt: false,
      managerApproved: true,
      managerApprovedBy: 'Manager Dave',
      reason: 'Customer verified in system'
    });

    expect(returnWorking.newStatus).toBe('in_stock');
    const s1 = serialRepo.findBySerialNumber(businessId, prodId, 'SN-TAB-01');
    expect(s1?.status).toBe('in_stock');

    // Case C: Return damaged unit with receipt -> moves to under_repair
    const returnDamaged = serialService.processCustomerReturn({
      businessId,
      serialNumber: 'SN-TAB-02',
      condition: 'damaged',
      hasOriginalReceipt: true,
      receiptNumber: 'INV-1001',
      reason: 'Cracked screen on unboxing'
    });

    expect(returnDamaged.newStatus).toBe('under_repair');
    const s2 = serialRepo.findBySerialNumber(businessId, prodId, 'SN-TAB-02');
    expect(s2?.status).toBe('under_repair');
  });

  // =========================================================================
  // TEST 9: IN-WARRANTY REPAIR & REPLACEMENT UNIT SWAP
  // =========================================================================
  it('9. Supports in-warranty repair claims and replacement unit swap with warranty transfer', () => {
    const prodId = productRepo.create({
      name: 'Smart Television 55-inch',
      sku: 'SKU-TV-55',
      barcode: 'BAR-TV-55',
      categoryId: 1,
      costPrice: 45000,
      sellingPrice: 65000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      warrantyDefaultMonths: 24
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locShopFloor,
      quantityScaled: 2000,
      serials: [
        { serialNumber: 'SN-TV-DEFECTIVE' },
        { serialNumber: 'SN-TV-REPLACEMENT' }
      ]
    });

    // Sell defective TV
    salesService.createSale({
      businessId,
      cashierId: 1,
      items: [
        {
          productId: prodId,
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 65000,
          serialNumbers: ['SN-TV-DEFECTIVE']
        }
      ],
      amountPaid: 65000
    });

    // Customer files warranty claim
    const claim = serialService.createWarrantyClaim({
      businessId,
      serialNumber: 'SN-TV-DEFECTIVE',
      issueDescription: 'Vertical line on screen',
      claimType: 'replacement'
    });
    expect(claim.status).toBe('under_repair');

    // Issue replacement unit from in-stock inventory
    const swap = serialService.replaceDefectiveSerial({
      businessId,
      defectiveSerialNumber: 'SN-TV-DEFECTIVE',
      replacementSerialNumber: 'SN-TV-REPLACEMENT',
      reason: 'Unrepairable panel defect under 24m warranty'
    });

    expect(swap.defectiveSerial.status).toBe('quarantined');
    expect(swap.replacementSerial.status).toBe('sold');

    // Verify transferred warranty on replacement unit
    const replWarranty = serialRepo.getWarrantyForSerial(swap.replacementSerial.id);
    expect(replWarranty).toBeDefined();
    expect(replWarranty?.warrantyReference).toContain('SN-TV-DEFECTIVE');
  });

  // =========================================================================
  // TEST 10: INTER-LOCATION TRANSFER & SERIAL AUDIT TIMELINE
  // =========================================================================
  it('10. Transfers serial between locations and provides complete audit trail with PII masking', () => {
    const prodId = productRepo.create({
      name: 'Digital Multimeter Pro',
      sku: 'SKU-DMM-PRO',
      barcode: 'BAR-DMM-PRO',
      categoryId: 1,
      costPrice: 15000,
      sellingPrice: 22000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      warrantyDefaultMonths: 12
    });

    serialService.receiveSerialUnits({
      businessId,
      productId: String(prodId),
      stockLocationId: locWarehouse,
      supplierId,
      quantityScaled: 1000,
      serials: [{ serialNumber: 'SN-DMM-001' }]
    });

    // Transfer from Warehouse to Shop Floor
    const trf = serialService.transferSerial({
      businessId,
      serialNumber: 'SN-DMM-001',
      fromLocationId: locWarehouse,
      toLocationId: locShopFloor,
      reason: 'Display restocking'
    });

    expect(trf.serial.currentLocationId).toBe(locShopFloor);
    const balWH = balanceRepo.getBalance(prodId, locWarehouse, businessId);
    const balShop = balanceRepo.getBalance(prodId, locShopFloor, businessId);
    expect(balWH?.onHandScaled).toBe(0);
    expect(balShop?.onHandScaled).toBe(1000);

    // Seed customer
    const testCustomerId = '77777777-7777-7777-7777-777777777777';
    db.prepare(`
      INSERT OR IGNORE INTO customers (id, business_id, customer_code, name, phone, customer_type, is_active)
      VALUES (?, ?, 'CUST-77', 'Dr. Ahmed Khan', '03001234567', 'retail', 1)
    `).run(testCustomerId, businessId);

    // Sell to customer
    salesService.createSale({
      businessId,
      cashierId: 1,
      customerId: testCustomerId,
      items: [
        {
          productId: prodId,
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 22000,
          serialNumbers: ['SN-DMM-001']
        }
      ],
      amountPaid: 22000
    });

    // Audit for cashier without cost & PII permissions
    const cashierAudit = serialService.getSerialAudit(businessId, 'SN-DMM-001', [
      Permission.VIEW_INVENTORY
    ]);

    expect(cashierAudit.maskedCost).toBe(true);
    expect(cashierAudit.serial.unitCostMinor).toBeNull();
    expect(cashierAudit.maskedCustomerPii).toBe(true);
    expect(cashierAudit.sale?.customerName).not.toBe('Dr. Ahmed Khan');
    expect(cashierAudit.sale?.customerName).toContain('***');

    // Audit for manager with full permissions
    const managerAudit = serialService.getSerialAudit(businessId, 'SN-DMM-001', [
      Permission.VIEW_COST_PRICES,
      Permission.VIEW_CUSTOMER_PII
    ]);

    expect(managerAudit.maskedCost).toBe(false);
    expect(managerAudit.serial.unitCostMinor).toBe(15000);
    expect(managerAudit.maskedCustomerPii).toBe(false);
    expect(managerAudit.sale?.customerName).toBe('Dr. Ahmed Khan');

    // Chronological history verification
    expect(managerAudit.history.length).toBeGreaterThanOrEqual(3);
    const eventTypes = managerAudit.history.map((h) => h.eventType);
    expect(eventTypes).toContain('PURCHASE_RECEIPT');
    expect(eventTypes).toContain('TRANSFER');
    expect(eventTypes).toContain('SALE');
  });

  // =========================================================================
  // TEST 11: MANUAL ENTRY PERMISSIONS
  // =========================================================================
  it('11. Blocks manual serial entry when manual entry is disabled by policy', () => {
    const prodId = productRepo.create({
      name: 'High Security Hardware Token',
      sku: 'SKU-TOKEN-SEC',
      barcode: 'BAR-TOKEN-SEC',
      categoryId: 1,
      costPrice: 5000,
      sellingPrice: 10000,
      currentStock: 0
    });

    serialService.configureSettings({
      businessId,
      productId: String(prodId),
      serialTrackingRequired: true,
      allowManualSerialEntry: false // Strict barcode scanner only!
    });

    expect(() => {
      serialService.receiveSerialUnits({
        businessId,
        productId: String(prodId),
        stockLocationId: locWarehouse,
        quantityScaled: 1000,
        serials: [
          {
            serialNumber: 'SN-SEC-01',
            isManualEntry: true // Typed via keyboard
          }
        ]
      });
    }).toThrow(ManualSerialEntryNotAllowedError);
  });
});
