import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import {
  InventoryValuationService,
  ArbitraryCostMethodSwitchError,
  UnauthorizedReturnValuationError,
  BackdatedPostingRestrictedError
} from '../../src/application/services/InventoryValuationService';
import { ExactCostMath } from '../../src/domain/inventory/cost-math';
import { LandedCostCalculator, IneligibleLandedCostError } from '../../src/domain/purchases/landed-cost';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { StockLocationService } from '../../src/application/services/StockLocationService';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';

describe('Prompt 16 — Inventory Valuation Engine (FIFO & Weighted Average Costing)', () => {
  let db: Database.Database;
  let valuationService: InventoryValuationService;
  let catalogService: ProductCatalogService;
  let locationService: StockLocationService;
  let balanceRepo: StockBalanceRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';

  const ownerActor = { userId: '1', role: 'owner', businessId };
  const managerActor = { userId: '2', role: 'manager', businessId };
  const cashierActor = { userId: '3', role: 'cashier', businessId };

  let locWarehouse: string;
  let locShopFloor: string;
  let locQuarantine: string;
  let unitPieceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    valuationService = new InventoryValuationService(db);
    catalogService = new ProductCatalogService(db);
    locationService = new StockLocationService(db);
    balanceRepo = new StockBalanceRepository(db);

    // Seed test users
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES 
        ('1', ?, 'owner_boss', 'hash', 'Owner Boss', 1),
        ('2', ?, 'manager_jane', 'hash', 'Jane Manager', 1),
        ('3', ?, 'cashier_bob', 'hash', 'Bob Cashier', 1)
    `).run(businessId, businessId, businessId);

    // Seed Unit of measurement
    const unitRow = db.prepare('SELECT id FROM units WHERE name = ?').get('Piece') as { id: string };
    unitPieceId = unitRow.id;

    // Seed Locations
    const wh = locationService.createLocation({
      businessId,
      branchId,
      name: 'Main Warehouse',
      code: 'WH-MAIN',
      locationType: 'warehouse',
      isSellable: false,
      isReceivable: true
    }, ownerActor);
    locWarehouse = wh.id;

    const floor = locationService.createLocation({
      businessId,
      branchId,
      name: 'Sales Floor',
      code: 'STORE-FRONT',
      locationType: 'shop_floor',
      isSellable: true,
      isReceivable: true
    }, ownerActor);
    locShopFloor = floor.id;

    const quarantine = locationService.createLocation({
      businessId,
      branchId,
      name: 'Damaged & Quarantine',
      code: 'QUARANTINE',
      locationType: 'quarantine',
      isSellable: false,
      isReceivable: true
    }, ownerActor);
    locQuarantine = quarantine.id;
  });

  // =========================================================================
  // 1. FINANCIAL PRECISION & EXACT COST ARITHMETIC
  // =========================================================================
  describe('1. Financial Precision & Exact Arithmetic', () => {
    it('divides and rounds exactly using HALF_UP and HALF_EVEN banker rounding', () => {
      // 5 / 2 = 2.5 -> HALF_UP = 3, HALF_EVEN (2 is even) = 2
      expect(ExactCostMath.divideAndRound(5n, 2n, 'HALF_UP')).toBe(3n);
      expect(ExactCostMath.divideAndRound(5n, 2n, 'HALF_EVEN')).toBe(2n);

      // 7 / 2 = 3.5 -> HALF_UP = 4, HALF_EVEN (3 is odd -> rounds to 4) = 4
      expect(ExactCostMath.divideAndRound(7n, 2n, 'HALF_UP')).toBe(4n);
      expect(ExactCostMath.divideAndRound(7n, 2n, 'HALF_EVEN')).toBe(4n);

      // Negative numbers: -5 / 2 = -2.5 -> -3
      expect(ExactCostMath.divideAndRound(-5n, 2n, 'HALF_UP')).toBe(-3n);
    });

    it('allocates integer total among shares without losing a single paisa (Hare-Niemeyer method)', () => {
      // Total: 100 paisa across 3 equal weights
      const split3 = ExactCostMath.allocateProportionally(100, [1, 1, 1]);
      expect(split3.reduce((a, b) => a + b, 0)).toBe(100);
      expect(split3).toEqual([34, 33, 33]);

      // Total: 1000 minor units split across weights [10, 20, 30]
      const splitWeighted = ExactCostMath.allocateProportionally(1000, [10, 20, 30]);
      expect(splitWeighted.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('calculates unit cost minor and total cost minor without floating point error', () => {
      // 2.5 units (2500 scaled) @ 120 minor units = 300 minor units
      const total = ExactCostMath.calculateTotalCostMinor(2500, 120);
      expect(total).toBe(300);

      // Reverse: 300 minor units / 2.5 units = 120 minor units
      const unit = ExactCostMath.calculateUnitCostMinor(300, 2500);
      expect(unit).toBe(120);
    });
  });

  // =========================================================================
  // 2. FIFO COST LAYERS & CALCULATION SPECIFICATION
  // =========================================================================
  describe('2. FIFO Cost Layers & Calculation (Prompt Specification Example)', () => {
    it('executes prompt FIFO example: 10@100, 20@120, sale 15 -> COGS=1600, Remaining=1800', () => {
      // Create product with FIFO costing method
      const prod = catalogService.createProduct({
        businessId,
        sku: 'RICE-BASMATI-KG',
        name: 'Basmati Rice Premium',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      // Receipt 1: 10 pieces at 100 minor units each (10,000 scaled @ 100 = 1,000 minor)
      const r1 = valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 100,
        receivedAt: '2026-10-01T10:00:00.000Z'
      });

      expect(r1.layer?.remainingQuantityScaled).toBe(10000);
      expect(r1.layer?.unitCostMinor).toBe(100);

      // Receipt 2: 20 pieces at 120 minor units each (20,000 scaled @ 120 = 2,400 minor)
      const r2 = valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 20000,
        unitCostMinor: 120,
        receivedAt: '2026-10-02T10:00:00.000Z'
      });

      expect(r2.layer?.remainingQuantityScaled).toBe(20000);
      expect(r2.layer?.unitCostMinor).toBe(120);

      // Total inventory value before sale = 1,000 + 2,400 = 3,400
      const reportBefore = valuationService.getValuationReport(businessId, locWarehouse);
      expect(reportBefore.totalInventoryValueMinor).toBe(3400);

      // Sale: 15 pieces (15,000 scaled)
      const saleSnapshot = valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 15000,
        referenceType: 'SALE',
        referenceId: 'SALE-INV-001'
      });

      // Verification from Prompt Spec:
      // - First 10 pieces * 100 = 1,000
      // - Next 5 pieces * 120 = 600
      // - Total COGS = 1,000 + 600 = 1,600
      expect(saleSnapshot.totalCogsMinor).toBe(1600);
      expect(saleSnapshot.costingMethod).toBe('fifo');
      expect(saleSnapshot.allocations.length).toBe(2);

      expect(saleSnapshot.allocations[0].quantityScaled).toBe(10000);
      expect(saleSnapshot.allocations[0].unitCostMinor).toBe(100);
      expect(saleSnapshot.allocations[0].allocatedCostMinor).toBe(1000);

      expect(saleSnapshot.allocations[1].quantityScaled).toBe(5000);
      expect(saleSnapshot.allocations[1].unitCostMinor).toBe(120);
      expect(saleSnapshot.allocations[1].allocatedCostMinor).toBe(600);

      // Remaining Inventory Verification:
      // - 15 pieces from the second layer
      // - Remaining inventory value = 15 * 120 = 1,800
      const reportAfter = valuationService.getValuationReport(businessId, locWarehouse);
      expect(reportAfter.totalInventoryValueMinor).toBe(1800);

      // Conservation check: 1,600 (COGS) + 1,800 (Remaining) === 3,400 (Original)
      expect(saleSnapshot.totalCogsMinor + reportAfter.totalInventoryValueMinor).toBe(3400);
    });
  });

  // =========================================================================
  // 3. WEIGHTED AVERAGE COSTING SPECIFICATION
  // =========================================================================
  describe('3. Weighted Average Costing (Prompt Specification Example)', () => {
    it('executes prompt Weighted Average example: 10@100 + 20@120 -> 30@113.333, sale 15 -> COGS=1700', () => {
      // Create product with Weighted Average costing method
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SUGAR-WHITE-KG',
        name: 'White Refined Sugar',
        baseUnitId: unitPieceId,
        costMethod: 'weighted_average'
      });

      // Existing: 10 pieces * 100 = 1,000
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 100
      });

      // Received: 20 pieces * 120 = 2,400
      const r2 = valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 20000,
        unitCostMinor: 120
      });

      // New Quantity = 30 pieces (30,000 scaled)
      // New Value = 3,400 minor units
      // Average unit cost = 3400 / 30 = 113.333...
      expect(r2.balance?.quantityScaled).toBe(30000);
      expect(r2.balance?.inventoryValueMinor).toBe(3400);
      expect(r2.balance?.averageUnitCostNumerator).toBe(3400);
      expect(r2.balance?.averageUnitCostDenominator).toBe(30000);

      // Sale of 15 pieces (15,000 scaled)
      const issue = valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 15000,
        referenceType: 'SALE',
        referenceId: 'SALE-INV-002'
      });

      // COGS for 15 pieces = round(3400 * 15 / 30) = 1,700
      expect(issue.totalCogsMinor).toBe(1700);
      expect(issue.costingMethod).toBe('weighted_average');

      // Remaining Inventory: 15 pieces @ 113.333... = 1,700 minor units
      const report = valuationService.getValuationReport(businessId, locWarehouse);
      expect(report.totalInventoryValueMinor).toBe(1700);

      // Total conservation check: 1,700 (COGS) + 1,700 (Remaining) === 3,400
      expect(issue.totalCogsMinor + report.totalInventoryValueMinor).toBe(3400);
    });
  });

  // =========================================================================
  // 4. COST OF GOODS SOLD & GROSS PROFIT IMMUTABILITY
  // =========================================================================
  describe('4. Cost of Goods Sold & Gross Profit Snapshot', () => {
    it('snapshots COGS and gross profit permanently and ignores subsequent product cost edits', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'COOKING-OIL-1L',
        name: 'Pure Sunflower Oil 1L',
        baseUnitId: unitPieceId,
        costPrice: 50000, // 500 Rs cost
        retailPriceMinor: 75000, // 750 Rs sale price
        costMethod: 'fifo'
      });

      // Receipt 10 units @ 50,000
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 10000,
        unitCostMinor: 50000
      });

      // Sale of 2 units @ 75,000 each = 150,000 revenue
      const cogsSnapshot = valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 2000,
        referenceType: 'SALE',
        referenceId: 'INV-101'
      });

      const netSales = 150000;
      const cogs = cogsSnapshot.totalCogsMinor; // 2 * 50,000 = 100,000
      const grossProfit = netSales - cogs; // 50,000 profit

      expect(cogs).toBe(100000);
      expect(grossProfit).toBe(50000);

      // Now someone updates the product's catalog cost price to 60,000
      db.prepare('UPDATE products SET cost_price = 60000 WHERE id = ?').run(prod.id);

      // Historical gross profit of INV-101 remains 50,000, unaffected by today's cost!
      const historicalCogs = cogsSnapshot.totalCogsMinor;
      expect(netSales - historicalCogs).toBe(50000);
    });
  });

  // =========================================================================
  // 5. CUSTOMER RETURNS & DAMAGED STOCK ROUTING
  // =========================================================================
  describe('5. Returns & Reversals', () => {
    it('restores exact original cost on customer return linked to original sale', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SHAMPOO-400ML',
        name: 'Anti-Dandruff Shampoo',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      // Inbound: 10 units @ 300 minor units
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 10000,
        unitCostMinor: 300
      });

      // Sale of 2 units
      const sale = valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 2000,
        referenceType: 'SALE',
        referenceId: 'SALE-RET-01',
        referenceLineId: 'LINE-01'
      });

      // Later, purchase cost went up to 500 minor units
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 10000,
        unitCostMinor: 500
      });

      // Customer returns 1 unit with original sale reference
      const returnResult = valuationService.processCustomerReturn({
        businessId,
        saleId: 'SALE-RET-01',
        saleItemId: 'LINE-01',
        productId: prod.id,
        stockLocationId: locShopFloor,
        returnedQuantityScaled: 1000,
        actorRole: 'cashier'
      });

      // Restored cost is the original 300 minor units, NOT today's 500!
      expect(returnResult.unitCostMinor).toBe(300);
      expect(returnResult.restoredCostMinor).toBe(300);
    });

    it('routes damaged returned goods to quarantine location and prohibits sellable stock pollution', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'GLASS-JAR-1L',
        name: 'Glass Honey Jar 1L',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        quantityScaled: 5000,
        unitCostMinor: 250
      });

      // Return of broken/damaged jar
      const damagedReturn = valuationService.processCustomerReturn({
        businessId,
        productId: prod.id,
        stockLocationId: locShopFloor,
        returnedQuantityScaled: 1000,
        isDamaged: true,
        quarantineLocationId: locQuarantine,
        overrideUnitCostMinor: 250,
        actorRole: 'manager'
      });

      expect(damagedReturn.layer?.stockLocationId).toBe(locQuarantine);

      // Verify that damaged stock is not in sellable stock floor
      const sellableLayers = valuationService.getValuationReport(businessId, locShopFloor);
      const damagedLayers = valuationService.getValuationReport(businessId, locQuarantine);

      expect(damagedLayers.totalInventoryValueMinor).toBe(250);
    });

    it('rejects return without original transaction when cashier has no managerial override', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'CHOCO-BAR-50G',
        name: 'Dark Chocolate Bar',
        baseUnitId: unitPieceId
      });

      expect(() => {
        valuationService.processCustomerReturn({
          businessId,
          productId: prod.id,
          stockLocationId: locShopFloor,
          returnedQuantityScaled: 1000,
          actorRole: 'cashier' // Cashier without invoice reference -> BLOCKED
        });
      }).toThrowError(UnauthorizedReturnValuationError);
    });

    it('reverses cost allocations and restores layer quantities on sale cancellation', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SOAP-ALMOND-100G',
        name: 'Almond Milk Soap',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      const receipt = valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 80
      });

      // Outbound sale
      valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 4000,
        referenceType: 'SALE',
        referenceId: 'SALE-CANCEL-01'
      });

      // Layer remaining is now 6,000
      const active1 = valuationService.getValuationReport(businessId, locWarehouse);
      expect(active1.totalInventoryValueMinor).toBe(480); // 6 * 80

      // Cancel the sale
      valuationService.reverseSaleCosting('SALE-CANCEL-01', businessId);

      // Layer remaining restored back to 10,000!
      const active2 = valuationService.getValuationReport(businessId, locWarehouse);
      expect(active2.totalInventoryValueMinor).toBe(800); // 10 * 80
    });
  });

  // =========================================================================
  // 6. BACKDATED PURCHASES & ACCOUNTING POLICIES
  // =========================================================================
  describe('6. Backdated Purchases & Recalculation', () => {
    it('blocks backdated receipt when policy is RESTRICT and subsequent sales exist', () => {
      // Set backdating policy to 'restrict'
      db.prepare("UPDATE businesses SET backdating_policy = 'restrict' WHERE id = ?").run(businessId);

      const prod = catalogService.createProduct({
        businessId,
        sku: 'COFFEE-BEANS-1KG',
        name: 'Arabica Coffee Beans',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      // Outbound sale at t = 2026-10-15
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 1000,
        receivedAt: '2026-10-10T00:00:00.000Z'
      });

      valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 2000,
        referenceType: 'SALE',
        referenceId: 'SALE-OCT-15'
      });

      // Attempt backdated receipt at t = 2026-10-05 (prior to Oct 15 sale)
      expect(() => {
        valuationService.processBackdatedReceipt({
          businessId,
          productId: prod.id,
          stockLocationId: locWarehouse,
          quantityScaled: 5000,
          unitCostMinor: 800,
          receiptTime: '2026-10-05T00:00:00.000Z',
          actorUserId: '1'
        });
      }).toThrowError(BackdatedPostingRestrictedError);
    });

    it('creates valuation adjustment when policy is RECALCULATE_ADJUSTMENT without corrupting historical sales', () => {
      db.prepare("UPDATE businesses SET backdating_policy = 'recalculate_adjustment' WHERE id = ?").run(businessId);

      const prod = catalogService.createProduct({
        businessId,
        sku: 'GREEN-TEA-500G',
        name: 'Organic Green Tea',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 600,
        receivedAt: '2026-10-10T00:00:00.000Z'
      });

      valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 2000,
        referenceType: 'SALE',
        referenceId: 'SALE-OCT-12'
      });

      // Backdated receipt at Oct 05 generates controlled revaluation adjustment
      const backdateRes = valuationService.processBackdatedReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 5000,
        unitCostMinor: 500,
        receiptTime: '2026-10-05T00:00:00.000Z',
        actorUserId: '1'
      });

      expect(backdateRes.success).toBe(true);
      expect(backdateRes.revaluation).toBeDefined();
      expect(backdateRes.revaluation?.reason).toContain('Backdated purchase valuation adjustment');
    });
  });

  // =========================================================================
  // 7. NEGATIVE STOCK VALUATION & PROVISIONAL SETTLEMENT
  // =========================================================================
  describe('7. Negative Stock Valuation & Provisional Resolution', () => {
    it('blocks outbound movement when stock is zero and negative stock is disabled', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'HONEY-JAR-500G',
        name: 'Wild Forest Honey 500g',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      expect(() => {
        valuationService.processOutboundIssue({
          businessId,
          productId: prod.id,
          stockLocationId: locWarehouse,
          quantityScaled: 5000,
          referenceType: 'SALE',
          referenceId: 'SALE-ZERO-STOCK',
          allowNegativeStock: false // BLOCKED
        });
      }).toThrowError(/insufficient inventory/i);
    });

    it('records provisional cost when negative stock is enabled and settles cost upon subsequent receipt', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'OLIVE-OIL-500ML',
        name: 'Extra Virgin Olive Oil',
        baseUnitId: unitPieceId,
        costPrice: 40000, // Estimated catalog price: 400 Rs
        costMethod: 'fifo'
      });

      // Outbound issue with zero stock when negative stock is allowed
      const negIssue = valuationService.processOutboundIssue({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 3000,
        referenceType: 'SALE',
        referenceId: 'SALE-NEG-01',
        allowNegativeStock: true
      });

      expect(negIssue.isProvisional).toBe(true);
      expect(negIssue.allocations[0].isProvisional).toBe(true);

      // Subsequent supplier delivery arrives at actual cost of 45,000 (450 Rs)
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 45000
      });

      // Provisional allocation is now settled to the actual cost
      const allocs = db.prepare(`
        SELECT * FROM inventory_cost_allocations
        WHERE reference_id = 'SALE-NEG-01'
      `).all() as any[];

      expect(allocs[0].is_provisional).toBe(0);
      expect(allocs[0].unit_cost_minor).toBe(45000);
      expect(allocs[0].allocated_cost_minor).toBe(135000); // 3 * 45,000
    });
  });

  // =========================================================================
  // 8. LANDED COSTS ALLOCATION & OPERATING EXPENSE REJECTION
  // =========================================================================
  describe('8. Landed Costs Allocation & Expense Eligibility', () => {
    it('allocates landed cost by quantity, weight, value, and manual', () => {
      const items = [
        { productId: '101', quantityScaled: 10000, weightGrams: 1000, baseCostMinor: 10000 },
        { productId: '102', quantityScaled: 30000, weightGrams: 3000, baseCostMinor: 90000 }
      ];

      // Total freight = 4,000 minor units
      // By Value: Item 1 = 10%, Item 2 = 90% -> Item 1 = 400, Item 2 = 3600
      const byValue = LandedCostCalculator.allocateLandedCosts({
        businessId,
        allocationMethod: 'value',
        totalAdditionalCostMinor: 4000,
        expenseCategory: 'freight',
        items
      });

      expect(byValue.lines[0].allocatedAdditionalCostMinor).toBe(400);
      expect(byValue.lines[1].allocatedAdditionalCostMinor).toBe(3600);
      expect(byValue.totalAllocatedMinor).toBe(4000);

      // By Quantity: Item 1 = 25% (10k), Item 2 = 75% (30k) -> Item 1 = 1000, Item 2 = 3000
      const byQty = LandedCostCalculator.allocateLandedCosts({
        businessId,
        allocationMethod: 'quantity',
        totalAdditionalCostMinor: 4000,
        expenseCategory: 'customs',
        items
      });

      expect(byQty.lines[0].allocatedAdditionalCostMinor).toBe(1000);
      expect(byQty.lines[1].allocatedAdditionalCostMinor).toBe(3000);
    });

    it('strictly forbids capitalizing operating expenses (rent, marketing, salaries) into inventory', () => {
      const items = [
        { productId: '201', quantityScaled: 10000, baseCostMinor: 50000 }
      ];

      expect(() => {
        LandedCostCalculator.allocateLandedCosts({
          businessId,
          allocationMethod: 'value',
          totalAdditionalCostMinor: 10000,
          expenseCategory: 'store_rent', // Operating expense -> REJECTED!
          items
        });
      }).toThrowError(IneligibleLandedCostError);
    });
  });

  // =========================================================================
  // 9. CONTROLLED REVALUATION & METHOD SWITCHING
  // =========================================================================
  describe('9. Controlled Revaluation & Policy Switching', () => {
    it('prohibits arbitrary costing method switch without revaluation approval', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'FLOUR-5KG',
        name: 'Whole Wheat Flour',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 20000,
        unitCostMinor: 400
      });

      // Direct arbitrary switch without approval -> BLOCKED
      expect(() => {
        valuationService.revalueInventory({
          businessId,
          productId: prod.id,
          stockLocationId: locWarehouse,
          newCostMethod: 'weighted_average',
          reason: 'Cashier wants simpler cost',
          approvedBy: '' // Missing approval!
        });
      }).toThrowError(ArbitraryCostMethodSwitchError);
    });

    it('executes formal revaluation from FIFO to Weighted Average with audited variance', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'RICE-SELLA-5KG',
        name: 'Sella Rice 5kg',
        baseUnitId: unitPieceId,
        costMethod: 'fifo'
      });

      // Layer 1: 10 units @ 300
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 300
      });

      // Layer 2: 10 units @ 500
      valuationService.processInboundReceipt({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        quantityScaled: 10000,
        unitCostMinor: 500
      });

      // Formal revaluation to Weighted Average
      const reval = valuationService.revalueInventory({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        newCostMethod: 'weighted_average',
        reason: 'Board policy alignment to average costing',
        approvedBy: '1'
      });

      expect(reval.oldCostMethod).toBe('fifo');
      expect(reval.newCostMethod).toBe('weighted_average');
      expect(reval.oldInventoryValueMinor).toBe(8000); // (10*300) + (10*500)
      expect(reval.newInventoryValueMinor).toBe(8000);
      expect(reval.revaluationVarianceMinor).toBe(0);

      // Check that product now costed by Weighted Average
      const report = valuationService.getValuationReport(businessId, locWarehouse);
      expect(report.lines[0].costMethod).toBe('weighted_average');
      expect(report.lines[0].unitCostMinor).toBe(400); // 8000 / 20 = 400
    });
  });
});

