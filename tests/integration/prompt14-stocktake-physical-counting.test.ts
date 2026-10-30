import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { StocktakeService } from '../../src/application/services/StocktakeService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { SalesService } from '../../src/application/services/SalesService';
import { PurchaseService } from '../../src/application/services/PurchaseService';
import { StockAdjustmentService } from '../../src/application/services/StockAdjustmentService';
import { StockAdjustmentRepository } from '../../src/infrastructure/sqlite/repositories/StockAdjustmentRepository';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockLocationRepository } from '../../src/infrastructure/sqlite/repositories/StockLocationRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import { PurchaseRepository } from '../../src/infrastructure/sqlite/repositories/PurchaseRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import {
  StockLocationFrozenError,
  StocktakeSecurityError,
  InvalidStocktakeStateError,
  StocktakeRules
} from '../../src/domain/inventory/stocktake-rules';

describe('Prompt 14 — Physical Stocktake, Counting Workflows & Discrepancy Audits', () => {
  let db: Database.Database;
  let stocktakeService: StocktakeService;
  let catalogService: ProductCatalogService;
  let salesService: SalesService;
  let purchaseService: PurchaseService;
  let adjService: StockAdjustmentService;
  let productRepo: ProductRepository;
  let locationRepo: StockLocationRepository;
  let balanceRepo: StockBalanceRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const warehouseLocationId = '00000000-0000-0000-0000-000000000004';

  const ownerActor = { userId: '1', role: 'owner', businessId, branchId };
  const supervisorActor = { userId: '2', role: 'supervisor', businessId, branchId };
  const counterActor = { userId: '3', role: 'counter', businessId, branchId };

  let unitPieceId: string;
  let catGroceryId: string;
  let catPharmaId: string;

  let setStock: (productId: string, locationId: string, qtyScaled: number, bizId?: string, branchId?: string) => void;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    // Seed test users
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES
        ('1', ?, 'owner_admin', 'hash123', 'Owner Boss', 1),
        ('2', ?, 'supervisor_jane', 'hash123', 'Jane Supervisor', 1),
        ('3', ?, 'counter_bob', 'hash123', 'Bob Counter', 1)
    `).run(businessId, businessId, businessId);

    // Seed test units and categories
    const uRow = db.prepare("SELECT id FROM units WHERE name = 'Piece' OR abbreviation = 'pc' LIMIT 1").get() as any;
    unitPieceId = uRow?.id || '00000000-0000-0000-0000-000000000001';

    catGroceryId = '00000000-0000-0000-0000-000000000010';
    catPharmaId = '00000000-0000-0000-0000-000000000011';

    db.prepare(`
      INSERT OR IGNORE INTO product_categories (id, business_id, name, is_active)
      VALUES (?, ?, 'Grocery', 1), (?, ?, 'Pharmacy', 1)
    `).run(catGroceryId, businessId, catPharmaId, businessId);

    stocktakeService = new StocktakeService(db);
    catalogService = new ProductCatalogService(db);
    productRepo = new ProductRepository(db);
    locationRepo = new StockLocationRepository(db);
    balanceRepo = new StockBalanceRepository(db);

    const adjRepo = new StockAdjustmentRepository(db);
    adjService = new StockAdjustmentService(
      adjRepo,
      locationRepo,
      balanceRepo,
      productRepo
    );

    const saleRepo = new SaleRepository(db);
    const customerRepo = new CustomerRepository(db);
    const accountRepo = new AccountRepository(db);
    const purchaseRepo = new PurchaseRepository(db);
    const supplierRepo = new SupplierRepository(db);

    salesService = new SalesService(saleRepo, productRepo, customerRepo, accountRepo);
    purchaseService = new PurchaseService(purchaseRepo, productRepo, supplierRepo, accountRepo);

    setStock = (productId: string, locationId: string, qtyScaled: number, _businessId?: string, _branchId?: string) => {
      balanceRepo.upsertDelta({
        productId,
        stockLocationId: locationId,
        businessId,
        onHandDeltaScaled: qtyScaled
      });
      db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(qtyScaled / 1000, productId);
    };
  });

  // =========================================================================
  // 1. WORKFLOW: CREATION, SCOPING & INITIAL SYSTEM SNAPSHOT
  // =========================================================================
  describe('1. Creation, Scope & Initial Snapshot', () => {
    it('creates full stocktake and snapshots current stock for all active products', () => {
      // Create 2 products
      const p1 = catalogService.createProduct({
        businessId,
        sku: 'RICE-BAS-5KG',
        name: 'Basmati Rice 5kg',
        baseUnitId: unitPieceId,
        costPrice: 80000,
        retailPriceMinor: 110000
      });
      const p2 = catalogService.createProduct({
        businessId,
        sku: 'SUGAR-1KG',
        name: 'White Sugar 1kg',
        baseUnitId: unitPieceId,
        costPrice: 12000,
        retailPriceMinor: 15000
      });

      // Establish stock balances (p1 = 50, p2 = 80)
      setStock(p1.id, warehouseLocationId, 50000, businessId, branchId);
      setStock(p2.id, warehouseLocationId, 80000, businessId, branchId);

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          countingMode: 'visible'
        },
        ownerActor
      );

      expect(st.stocktakeNumber).toMatch(/^STK-\d{4}-\d{5}$/);
      expect(st.status).toBe('draft');
      expect(st.lines?.length).toBe(2);

      const lineRice = st.lines?.find((l) => l.productId === p1.id);
      const lineSugar = st.lines?.find((l) => l.productId === p2.id);

      expect(lineRice?.systemQuantityScaled).toBe(50000);
      expect(lineRice?.countStatus).toBe('uncounted');
      expect(lineSugar?.systemQuantityScaled).toBe(80000);
      expect(lineSugar?.countStatus).toBe('uncounted');
    });

    it('creates category-scoped stocktake including only products in that category', () => {
      // pGrocery in Grocery, pPharma in Pharmacy
      const pGrocery = catalogService.createProduct({
        businessId,
        categoryId: catGroceryId,
        sku: 'BISCUIT-CHOCO',
        name: 'Choco Biscuit',
        baseUnitId: unitPieceId
      });
      const pPharma = catalogService.createProduct({
        businessId,
        categoryId: catPharmaId,
        sku: 'PANADOL-500MG',
        name: 'Panadol 500mg',
        baseUnitId: unitPieceId
      });

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'category',
          scopeCategoryId: catPharmaId
        },
        ownerActor
      );

      expect(st.lines?.length).toBe(1);
      expect(st.lines?.[0].productId).toBe(pPharma.id);
    });
  });

  // =========================================================================
  // 2. BLIND VS VISIBLE COUNTING ENFORCEMENT (Security Rule)
  // =========================================================================
  describe('2. Blind vs Visible Counting Server-Side Masking', () => {
    it('strictly strips system_quantity and difference from counter payload when blind counting', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'PERFUME-ROYAL',
        name: 'Royal Fragrance',
        baseUnitId: unitPieceId,
        costPrice: 500000
      });
      setStock(prod.id, warehouseLocationId, 100000, businessId, branchId);

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          countingMode: 'blind'
        },
        ownerActor
      );

      stocktakeService.startStocktake(st.id, ownerActor);

      // 1. Counter fetches stocktake details
      const counterView = stocktakeService.getStocktakeById(st.id, counterActor);
      const counterLine = counterView?.lines?.[0];

      // CRITICAL ASSERTION: System quantity is strictly null for counter!
      expect(counterLine?.systemQuantityScaled).toBeNull();
      expect(counterLine?.expectedQuantityScaled).toBeNull();
      expect(counterLine?.differenceQuantityScaled).toBeNull();

      // 2. Counter records count of 98 (actual is 100)
      const recorded = stocktakeService.recordCount(
        {
          stocktakeId: st.id,
          productId: prod.id,
          countedQuantityScaled: 98000
        },
        counterActor
      );

      // Return DTO for counter must also have masked system quantities
      expect(recorded.countedQuantityScaled).toBe(98000);
      expect(recorded.systemQuantityScaled).toBeNull();
      expect(recorded.differenceQuantityScaled).toBeNull();

      // 3. Supervisor viewing during active counting cannot leak live diffs to counters
      // But in review phase, supervisor sees complete reconciliation
      stocktakeService.submitCounts(st.id, counterActor);
      stocktakeService.reviewStocktake(st.id, supervisorActor);

      const supervisorView = stocktakeService.getStocktakeById(st.id, supervisorActor);
      const supLine = supervisorView?.lines?.[0];

      expect(supLine?.systemQuantityScaled).toBe(100000);
      expect(supLine?.countedQuantityScaled).toBe(98000);
      expect(supLine?.differenceQuantityScaled).toBe(-2000); // -2 deficit
    });
  });

  // =========================================================================
  // 3. POLICY A: FREEZE STOCK & EMERGENCY OVERRIDE
  // =========================================================================
  describe('3. Policy A: Location Freeze & Emergency Override', () => {
    it('blocks regular sales, purchases, and adjustments when location is frozen', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'COOKING-OIL-5L',
        name: 'Cooking Oil 5L',
        baseUnitId: unitPieceId,
        retailPriceMinor: 200000,
        costPrice: 150000
      });
      setStock(prod.id, warehouseLocationId, 40000, businessId, branchId);

      // Start frozen stocktake
      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          freezeStock: true
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      // 1. Cashier attempts to complete a sale from frozen location -> BLOCKED!
      expect(() => {
        salesService.createSale({
          businessId,
          locationId: warehouseLocationId,
          items: [{ productId: prod.id as any, quantity: 2, conversionFactor: 1, unitPrice: 200000 }],
          paymentMethod: 'CASH' as any,
          amountPaid: 400000,
          cashierId: 3,
          userId: 3,
          userRole: 'cashier'
        });
      }).toThrowError(StockLocationFrozenError);

      // 2. Inventory clerk attempts stock adjustment -> BLOCKED!
      expect(() => {
        adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: warehouseLocationId,
            adjustmentType: 'decrease',
            reasonCode: 'DAMAGED',
            reasonDescription: 'Forklift accident',
            lines: [{ productId: prod.id, countedQuantityScaled: 38000 }]
          },
          { userId: '3', role: 'clerk', businessId }
        );
      }).toThrowError(StockLocationFrozenError);

      // 3. Supervisor emergency override -> ALLOWED!
      expect(() => {
        salesService.createSale({
          businessId,
          locationId: warehouseLocationId,
          items: [
            {
              productId: prod.id as any,
              quantity: 1,
              conversionFactor: 1,
              unitPrice: 200000,
              costPrice: 150000,
              discountPercent: 0,
              discountAmount: 0
            }
          ],
          paymentMethod: 'CASH' as any,
          amountPaid: 200000,
          cashierId: 2,
          userId: 2,
          userRole: 'supervisor',
          overrideFreeze: true
        } as any);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 4. POLICY B: CONTINUE TRANSACTIONS & CUTOFF FORMULA
  // =========================================================================
  describe('4. Policy B: Live Reconciliation with Cutoff Formula', () => {
    it('applies ExpectedAtCountTime = SnapshotStock + MovementsBeforeCountCutoff correctly', () => {
      // 1. Create Product with initial snapshot 100 units at 10:00
      const prod = catalogService.createProduct({
        businessId,
        sku: 'MILK-TETRA-1L',
        name: 'Whole Milk 1L',
        baseUnitId: unitPieceId,
        costPrice: 20000
      });
      setStock(prod.id, warehouseLocationId, 100000, businessId, branchId);

      // Initiate Policy B stocktake (freezeStock = false)
      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          countingMode: 'visible',
          freezeStock: false
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      const snapshotTime = new Date().toISOString();

      // 2. Sale 1 occurs at 10:15 (movement: -5 units)
      db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id,
          unit_precision, unit_cost_minor, total_cost_minor,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at, location_id
        ) VALUES (
          'mov-sale-1', ?, ?, ?, ?,
          'SALE', 'OUT', 5000, ?,
          3, 20000, 100000,
          'SALE', 'sale-1', 'idem-sale-1', ?, ?, 1
        )
      `).run(businessId, branchId, prod.id, warehouseLocationId, unitPieceId, snapshotTime, snapshotTime);

      // 3. Counter counts stock at 10:30 and enters 95 units physically present
      const line = stocktakeService.recordCount(
        {
          stocktakeId: st.id,
          productId: prod.id,
          countedQuantityScaled: 95000
        },
        counterActor
      );

      // Formula Check:
      // Expected = Snapshot (100) + MovementsCutoff (-5) = 95
      // Difference = Counted (95) - Expected (95) = 0
      expect(line.cutoffMovementsQtyScaled).toBe(-5000);
      expect(line.expectedQuantityScaled).toBe(95000);
      expect(line.differenceQuantityScaled).toBe(0);

      // 4. Sale 2 occurs at 10:45 AFTER the physical count was completed
      const afterCountTime = new Date(Date.now() + 5000).toISOString();
      db.prepare(`
        INSERT INTO stock_movements (
          id, business_id, branch_id, product_id, stock_location_id,
          movement_type, direction, quantity_scaled, base_unit_id,
          unit_precision, unit_cost_minor, total_cost_minor,
          reference_type, reference_id, idempotency_key, occurred_at, posted_at, location_id
        ) VALUES (
          'mov-sale-2', ?, ?, ?, ?,
          'SALE', 'OUT', 2000, ?,
          3, 20000, 40000,
          'SALE', 'sale-2', 'idem-sale-2', ?, ?, 1
        )
      `).run(businessId, branchId, prod.id, warehouseLocationId, unitPieceId, afterCountTime, afterCountTime);

      // Stocktake submission & review: The post-count sale of 2 units must NOT affect the count difference!
      stocktakeService.submitCounts(st.id, counterActor);
      stocktakeService.reviewStocktake(st.id, supervisorActor);

      const reviewSt = stocktakeService.getStocktakeById(st.id, supervisorActor);
      const reviewedLine = reviewSt?.lines?.[0];

      expect(reviewedLine?.differenceQuantityScaled).toBe(0); // Perfect match at count time!
    });
  });

  // =========================================================================
  // 5. RECOUNT POLICIES & DISCREPANCY RESOLUTIONS
  // =========================================================================
  describe('5. Recount Policies & Discrepancy Resolutions', () => {
    it('requires recount when variance exceeds threshold and preserves multiple count attempts', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'LAPTOP-PRO-15',
        name: 'Pro Laptop 15 inch',
        baseUnitId: unitPieceId,
        costPrice: 15000000 // Rs. 150,000
      });
      setStock(prod.id, warehouseLocationId, 20000, businessId, branchId); // 20 units

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          countingMode: 'visible'
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      // 1. Initial count: Counter enters 12 (discrepancy of -8 units, Rs. 1,200,000 value)
      const count1 = stocktakeService.recordCount(
        {
          stocktakeId: st.id,
          productId: prod.id,
          countedQuantityScaled: 12000
        },
        counterActor
      );

      // Triggers auto-recount requirement!
      expect(count1.countStatus).toBe('recount_required');
      expect(count1.differenceQuantityScaled).toBe(-8000);

      // 2. Second count attempt (Recount): Recount person finds 19 units
      const count2 = stocktakeService.recordCount(
        {
          stocktakeId: st.id,
          productId: prod.id,
          countedQuantityScaled: 19000,
          countSequence: 2
        },
        counterActor
      );

      // Verify multiple count entries are preserved intact
      expect(count2.countEntries?.length).toBe(2);
      expect(count2.countEntries?.[0].countedQuantityScaled).toBe(12000);
      expect(count2.countEntries?.[1].countedQuantityScaled).toBe(19000);

      // 3. Supervisor resolves discrepancy by supervisor override to 19 units
      const resolved = stocktakeService.resolveDiscrepancy(
        {
          stocktakeId: st.id,
          lineId: count2.id,
          action: 'accept_sequence',
          acceptedCountSequence: 2,
          notes: 'Supervisor re-inspected shelf and confirmed 19 units'
        },
        supervisorActor
      );

      expect(resolved.countStatus).toBe('resolved');
      expect(resolved.countedQuantityScaled).toBe(19000);
      expect(resolved.differenceQuantityScaled).toBe(-1000); // 19 - 20 = -1 deficit
    });

    it('evaluates resolution rules: two matching counts auto-accepted', () => {
      const matchEval = StocktakeRules.evaluateTwoCounts(50000, 50000);
      expect(matchEval.status).toBe('matching');

      const mismatchEval = StocktakeRules.evaluateTwoCounts(50000, 48000);
      expect(mismatchEval.status).toBe('mismatch');

      const threeEval = StocktakeRules.evaluateThreeCounts(10000, 12000, 12000);
      expect(threeEval.status).toBe('matching');
      expect(threeEval.acceptedCount).toBe(12000);
    });
  });

  // =========================================================================
  // 6. DYNAMIC FOUND ITEMS / UNLISTED PRODUCTS
  // =========================================================================
  describe('6. Dynamic Found Stock', () => {
    it('creates dynamic stocktake line with 0 system stock when unlisted product is scanned', () => {
      const foundProd = catalogService.createProduct({
        businessId,
        sku: 'MYSTERY-BOX-FOUND',
        barcode: '998877665544',
        name: 'Unrecorded Found Item',
        baseUnitId: unitPieceId,
        costPrice: 5000
      });

      // Product has 0 stock recorded
      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'selected_products',
          countingMode: 'visible',
          selectedProductIds: [] // Initially empty
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      // Counter scans the found item
      const line = stocktakeService.recordCount(
        {
          stocktakeId: st.id,
          productBarcode: '998877665544',
          countedQuantityScaled: 4000 // 4 units discovered
        },
        counterActor
      );

      expect(line.productId).toBe(foundProd.id);
      expect(line.systemQuantityScaled).toBe(0);
      expect(line.countedQuantityScaled).toBe(4000);
      expect(line.differenceQuantityScaled).toBe(4000); // +4 surplus
    });
  });

  // =========================================================================
  // 7. POSTING & ATOMIC STOCK MOVEMENTS
  // =========================================================================
  describe('7. Posting & Atomic Movements', () => {
    it('posts surplus and deficit adjustments atomically and prevents double posting', () => {
      const pSurplus = catalogService.createProduct({
        businessId,
        sku: 'ITEM-SURPLUS',
        name: 'Surplus Item',
        baseUnitId: unitPieceId,
        costPrice: 10000
      });
      const pDeficit = catalogService.createProduct({
        businessId,
        sku: 'ITEM-DEFICIT',
        name: 'Deficit Item',
        baseUnitId: unitPieceId,
        costPrice: 20000
      });

      setStock(pSurplus.id, warehouseLocationId, 10000, businessId, branchId); // 10 recorded
      setStock(pDeficit.id, warehouseLocationId, 25000, businessId, branchId); // 25 recorded

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full'
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      // Count Surplus item: counted 13 (diff +3)
      stocktakeService.recordCount({
        stocktakeId: st.id,
        productId: pSurplus.id,
        countedQuantityScaled: 13000
      }, counterActor);

      // Count Deficit item: counted 20 (diff -5)
      stocktakeService.recordCount({
        stocktakeId: st.id,
        productId: pDeficit.id,
        countedQuantityScaled: 20000
      }, counterActor);

      // Workflow: Submit -> Review -> Approve -> Post
      stocktakeService.submitCounts(st.id, counterActor);
      stocktakeService.reviewStocktake(st.id, supervisorActor);
      stocktakeService.approveStocktake(st.id, supervisorActor);

      const posted = stocktakeService.postStocktake(st.id, ownerActor);
      expect(posted.status).toBe('posted');
      expect(posted.postedAt).toBeDefined();

      // Verify Stock Movements
      const movements = db.prepare(`
        SELECT movement_type, direction, quantity_scaled
        FROM stock_movements
        WHERE reference_id = ?
        ORDER BY movement_type ASC
      `).all(st.id) as any[];

      expect(movements.length).toBe(2);

      const defMov = movements.find((m) => m.movement_type === 'STOCKTAKE_DEFICIT');
      const surMov = movements.find((m) => m.movement_type === 'STOCKTAKE_SURPLUS');

      expect(defMov.direction).toBe('OUT');
      expect(defMov.quantity_scaled).toBe(5000); // 5 units

      expect(surMov.direction).toBe('IN');
      expect(surMov.quantity_scaled).toBe(3000); // 3 units

      // Verify updated stock balances
      const balSurplus = balanceRepo.getBalance(pSurplus.id, warehouseLocationId, businessId);
      const balDeficit = balanceRepo.getBalance(pDeficit.id, warehouseLocationId, businessId);

      expect(balSurplus?.onHandScaled).toBe(13000); // 10 + 3 = 13
      expect(balDeficit?.onHandScaled).toBe(20000); // 25 - 5 = 20

      // Idempotency: Attempting second posting is strictly blocked!
      expect(() => {
        stocktakeService.postStocktake(st.id, ownerActor);
      }).toThrowError(InvalidStocktakeStateError);
    });
  });

  // =========================================================================
  // 8. AUDIT REPORTING
  // =========================================================================
  describe('8. Stocktake Audit Reporting', () => {
    it('generates comprehensive stocktake audit metrics and financial variances', () => {
      const p1 = catalogService.createProduct({
        businessId,
        sku: 'REPORT-PROD-1',
        name: 'Report Prod 1',
        baseUnitId: unitPieceId,
        costPrice: 50000,
        purchaseCostMinor: 50000 // Rs. 500
      });
      setStock(p1.id, warehouseLocationId, 10000, businessId, branchId);

      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full'
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      stocktakeService.recordCount({
        stocktakeId: st.id,
        productId: p1.id,
        countedQuantityScaled: 12000 // +2 surplus (+Rs. 1,000)
      }, counterActor);

      const rep = stocktakeService.getStocktakeReport(st.id, ownerActor);

      expect(rep.metrics.totalScopedItems).toBe(1);
      expect(rep.metrics.totalCountedItems).toBe(1);
      expect(rep.metrics.surplusItemsCount).toBe(1);
      expect(rep.metrics.totalSurplusQuantityScaled).toBe(2000);
      expect(rep.metrics.totalSurplusValueMinor).toBe(100000); // Rs. 1,000.00 (100,000 paisa)
      expect(rep.metrics.netMonetaryVarianceMinor).toBe(100000);
      expect(rep.metrics.discrepancyRatePercentage).toBe(100);
    });
  });

  // =========================================================================
  // 9. CANCELLATION & UNFREEZE
  // =========================================================================
  describe('9. Cancellation & Unfreeze', () => {
    it('cancels stocktake and unlocks frozen stock location', () => {
      const st = stocktakeService.createStocktake(
        {
          businessId,
          stockLocationId: warehouseLocationId,
          countMode: 'full',
          freezeStock: true
        },
        ownerActor
      );
      stocktakeService.startStocktake(st.id, ownerActor);

      // Verify location is frozen
      expect(stocktakeService.checkLocationFreeze(warehouseLocationId).isFrozen).toBe(true);

      // Cancel stocktake
      const cancelled = stocktakeService.cancelStocktake(st.id, 'Emergency system drill cancelled', ownerActor);
      expect(cancelled.status).toBe('cancelled');

      // Verify location is now unfrozen!
      expect(stocktakeService.checkLocationFreeze(warehouseLocationId).isFrozen).toBe(false);
    });
  });
});
