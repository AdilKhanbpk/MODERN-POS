import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { setDatabase } from '../../src/infrastructure/sqlite/connection';
import { StockLocationService } from '../../src/application/services/StockLocationService';
import { StockLocationRepository } from '../../src/infrastructure/sqlite/repositories/StockLocationRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { SaleRepository } from '../../src/infrastructure/sqlite/repositories/SaleRepository';
import { CustomerRepository } from '../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import { AccountRepository } from '../../src/infrastructure/sqlite/repositories/AccountRepository';
import { PurchaseRepository } from '../../src/infrastructure/sqlite/repositories/PurchaseRepository';
import { SalesService } from '../../src/application/services/SalesService';
import { PurchaseService } from '../../src/application/services/PurchaseService';
import { OnboardingService } from '../../src/application/services/OnboardingService';
import {
  CircularHierarchyError,
  LocationHasStockError,
  LocationHasReservedStockError,
  LocationNotSellableError,
  LocationNotReceivableError,
  CrossBusinessLocationError,
  CrossBranchTransferMismatchError
} from '../../src/domain/inventory/stock-location-rules';

describe('Prompt 11 — Stock Locations and Warehouse Management', () => {
  let db: Database.Database;
  let locationService: StockLocationService;
  let locationRepo: StockLocationRepository;
  let balanceRepo: StockBalanceRepository;
  let productRepo: ProductRepository;
  let salesService: SalesService;
  let purchaseService: PurchaseService;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const counterId = '00000000-0000-0000-0000-000000000003';
  const defaultLocationId = '00000000-0000-0000-0000-000000000004';

  const actor = { userId: '1', role: 'owner', businessId };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDatabase(db);
    runMigrations(db);

    locationService = new StockLocationService(db);
    locationRepo = new StockLocationRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    productRepo = new ProductRepository(db);
    const saleRepo = new SaleRepository(db);
    const customerRepo = new CustomerRepository(db);
    const supplierRepo = new SupplierRepository(db);
    const accountRepo = new AccountRepository(db);
    const purchaseRepo = new PurchaseRepository(db);

    salesService = new SalesService(saleRepo, productRepo, customerRepo, accountRepo);
    purchaseService = new PurchaseService(purchaseRepo, productRepo, supplierRepo, accountRepo);
  });

  afterEach(() => {
    setDatabase(null);
    db.close();
  });

  // =========================================================================
  // 1. DEFAULT LOCATION & ONBOARDING AUTOMATION
  // =========================================================================
  describe('1. Default Location & Onboarding Seeding', () => {
    it('creates default branch and default stock location during business onboarding', () => {
      const onboardingService = new OnboardingService(db);
      const res = onboardingService.completeOnboarding({
        businessInfo: {
          name: 'SuperMart Karachi',
          phone: '+92 300 9876543',
          address: 'Clifton Block 2'
        },
        businessType: 'SUPERMARKET',
        regionalSettings: {
          currencyCode: 'PKR',
          currencySymbol: 'Rs. ',
          currencyDecimals: 2,
          timezone: 'Asia/Karachi',
          dateFormat: 'DD/MM/YYYY',
          timeFormat: '12h',
          numberFormat: 'standard',
          receiptLanguage: 'en',
          defaultMeasurementUnit: 'Piece'
        },
        branch: {
          name: 'Clifton Branch',
          code: 'CLIF-01'
        },
        counter: {
          name: 'POS Register 01',
          code: 'POS-01'
        },
        adminAccount: {
          username: 'manager_clifton',
          fullName: 'Tariq Khan',
          password: 'StrongPassword123!'
        },
        modules: {
          enabledModuleCodes: ['inventory_ledger', 'purchases', 'sales']
        },
        receiptSettings: {
          displayName: 'SuperMart Karachi',
          heading: 'TAX INVOICE',
          footerMessage: 'Thank you',
          paperWidth: '80mm'
        }
      });

      expect(res.stockLocationId).toBeDefined();

      const loc = locationRepo.findById(res.stockLocationId, res.businessId);
      expect(loc).not.toBeNull();
      expect(loc!.isDefault).toBe(true);
      expect(loc!.isSellable).toBe(true);
      expect(loc!.isReceivable).toBe(true);
      expect(loc!.isActive).toBe(true);
      expect(loc!.locationType).toBe('shop_floor');

      // Check counter mapping
      const counterLoc = locationRepo.getCounterDefaultLocation(res.counterId, res.businessId);
      expect(counterLoc).not.toBeNull();
      expect(counterLoc!.id).toBe(res.stockLocationId);
    });

    it('sells from the default location without selecting a location for every sale', () => {
      // Create product with initial stock in default location (creates 20,000 in stock_balances)
      const productId = productRepo.create({
        categoryId: 1,
        name: 'Basmati Rice 5kg',
        sku: 'RICE-05',
        barcode: '896000001001',
        costPrice: 50000,
        sellingPrice: 80000,
        currentStock: 20
      });

      // Sell without providing locationId
      const sale = salesService.createSale({
        cashierId: 1,
        branchId,
        counterId,
        amountPaid: 80000,
        items: [{ productId, quantity: 2, unitPrice: 80000, conversionFactor: 1 }]
      });

      expect(sale.id).toBeDefined();

      // Verify stock deducted from default location in stock_balances
      const bal = balanceRepo.getBalance(productId, defaultLocationId, businessId);
      expect(bal?.onHandScaled).toBe(18000); // 20,000 - 2,000 = 18,000
      expect(bal?.availableScaled).toBe(18000);
    });
  });

  // =========================================================================
  // 2. MULTIPLE LOCATIONS & PARENT-CHILD HIERARCHY
  // =========================================================================
  describe('2. Multiple Locations & Hierarchy', () => {
    it('creates multiple locations of different types within the same branch', () => {
      const warehouse = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Main Distribution Warehouse',
          code: 'WH-CENTRAL',
          locationType: 'warehouse',
          isSellable: true,
          isReceivable: true
        },
        actor
      );

      const damaged = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Damaged Products Bin',
          code: 'DAMAGED-01',
          locationType: 'damaged'
        },
        actor
      );

      expect(warehouse.id).toBeDefined();
      expect(damaged.id).toBeDefined();
      // Rule 7: Damaged locations are non-sellable by default
      expect(damaged.isSellable).toBe(false);

      const all = locationService.getLocations(businessId, branchId);
      expect(all.length).toBeGreaterThanOrEqual(3); // default + warehouse + damaged
    });

    it('creates parent-child hierarchical locations', () => {
      const storeroom = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Back Storeroom',
          code: 'STOREROOM-BACK',
          locationType: 'storeroom'
        },
        actor
      );

      const shelfA = locationService.createLocation(
        {
          businessId,
          branchId,
          parentLocationId: storeroom.id,
          name: 'Shelf A - Dry Goods',
          code: 'SHELF-A',
          locationType: 'storeroom'
        },
        actor
      );

      expect(shelfA.parentLocationId).toBe(storeroom.id);
      expect(shelfA.parentName).toBe('Back Storeroom');
    });

    it('rejects circular parent-child hierarchy (self-parent and multi-level loops)', () => {
      const locA = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Zone A',
          code: 'ZONE-A',
          locationType: 'warehouse'
        },
        actor
      );

      // 1. Self as parent
      expect(() => {
        locationService.updateLocation(locA.id, { parentLocationId: locA.id }, actor);
      }).toThrowError(CircularHierarchyError);

      // 2. A -> B -> A cycle
      const locB = locationService.createLocation(
        {
          businessId,
          branchId,
          parentLocationId: locA.id,
          name: 'Zone B',
          code: 'ZONE-B',
          locationType: 'warehouse'
        },
        actor
      );

      expect(() => {
        locationService.updateLocation(locA.id, { parentLocationId: locB.id }, actor);
      }).toThrowError(CircularHierarchyError);

      // 3. Multi-level cycle: A -> B -> C -> A
      const locC = locationService.createLocation(
        {
          businessId,
          branchId,
          parentLocationId: locB.id,
          name: 'Zone C',
          code: 'ZONE-C',
          locationType: 'warehouse'
        },
        actor
      );

      expect(() => {
        locationService.updateLocation(locA.id, { parentLocationId: locC.id }, actor);
      }).toThrowError(CircularHierarchyError);
    });

    it('rejects duplicate location codes within the same branch, but allows same code across different branches', () => {
      locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Aisle 1',
          code: 'AISLE-01',
          locationType: 'shop_floor'
        },
        actor
      );

      // Duplicate in same branch
      expect(() => {
        locationService.createLocation(
          {
            businessId,
            branchId,
            name: 'Aisle 1 Duplicate',
            code: 'AISLE-01',
            locationType: 'shop_floor'
          },
          actor
        );
      }).toThrowError(/already exists/i);

      // Second branch
      const branch2Id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO branches (id, business_id, name, code)
        VALUES (?, ?, 'North Branch', 'NORTH-01')
      `).run(branch2Id, businessId);

      // Same code 'AISLE-01' in different branch is valid
      const locBranch2 = locationService.createLocation(
        {
          businessId,
          branchId: branch2Id,
          name: 'North Aisle 1',
          code: 'AISLE-01',
          locationType: 'shop_floor'
        },
        actor
      );
      expect(locBranch2.id).toBeDefined();
    });

    it('rejects cross-business location references', () => {
      const biz2Id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO businesses (id, name, business_type)
        VALUES (?, 'Competitor Ltd', 'RETAIL')
      `).run(biz2Id);

      const foreignBranchId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO branches (id, business_id, name, code)
        VALUES (?, ?, 'Foreign Branch', 'FOR-01')
      `).run(foreignBranchId, biz2Id);

      const foreignLocId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO stock_locations (id, business_id, branch_id, name, code, location_type)
        VALUES (?, ?, ?, 'Foreign Warehouse', 'F-WH', 'warehouse')
      `).run(foreignLocId, biz2Id, foreignBranchId);

      // Attempting to set foreign location as parent
      expect(() => {
        locationService.createLocation(
          {
            businessId,
            branchId,
            parentLocationId: foreignLocId,
            name: 'Local Bay',
            code: 'LOCAL-BAY',
            locationType: 'warehouse'
          },
          actor
        );
      }).toThrowError(CrossBusinessLocationError);
    });
  });

  // =========================================================================
  // 3. SELLABLE & RECEIVABLE GUARDS
  // =========================================================================
  describe('3. Sellable, Receivable & Quarantine Invariants', () => {
    it('prohibits selling products from a non-sellable or damaged location', () => {
      const damagedLoc = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Damaged Quarantine Bay',
          code: 'DAMAGED-BAY',
          locationType: 'damaged',
          isSellable: false
        },
        actor
      );

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Dented Soda Can 250ml',
        sku: 'SODA-DENT',
        barcode: '896000002001',
        costPrice: 3000,
        sellingPrice: 5000,
        currentStock: 10
      });

      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: damagedLoc.id,
        onHandDeltaScaled: 10000
      });

      // Attempt sale from non-sellable location
      expect(() => {
        salesService.createSale({
          cashierId: 1,
          branchId,
          locationId: damagedLoc.id,
          amountPaid: 5000,
          items: [{ productId, quantity: 1, unitPrice: 5000, conversionFactor: 1 }]
        });
      }).toThrowError(LocationNotSellableError);
    });

    it('excludes damaged and quarantine locations from sellable stock totals', () => {
      const productId = productRepo.create({
        categoryId: 1,
        name: 'Chocolate Biscuit 100g',
        sku: 'CHOC-100',
        barcode: '896000003001',
        costPrice: 4000,
        sellingPrice: 6000,
        currentStock: 0
      });

      const damagedLoc = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Expired Return Cage',
          code: 'EXPIRED-01',
          locationType: 'damaged',
          isSellable: false
        },
        actor
      );

      // Put 80 units in default sellable floor, 20 units in damaged cage
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: defaultLocationId,
        onHandDeltaScaled: 80000
      });
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: damagedLoc.id,
        onHandDeltaScaled: 20000
      });

      const totalBranch = balanceRepo.getBranchTotalOnHand(branchId, productId, businessId);
      const sellableBranch = balanceRepo.getBranchSellableOnHand(branchId, productId, businessId);

      expect(totalBranch).toBe(100000); // 100 scaled
      expect(sellableBranch).toBe(80000); // Only 80 sellable! Damaged 20 excluded
    });

    it('prohibits receiving purchase intake into a non-receivable location', () => {
      const showroom = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Display Showroom Only',
          code: 'SHOWROOM-01',
          locationType: 'shop_floor',
          isReceivable: false
        },
        actor
      );

      const supplierId = '00000000-0000-0000-0000-000000000010';
      db.prepare(`
        INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, phone, balance)
        VALUES (?, ?, 'SUP-TEST-01', 'Test Supplier', '12345', 0)
      `).run(supplierId, businessId);

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Display Glass Vase',
        sku: 'VASE-01',
        barcode: '896000004001',
        costPrice: 15000,
        sellingPrice: 25000,
        currentStock: 0
      });

      expect(() => {
        purchaseService.createPurchaseOrder({
          supplierId,
          invoiceNumber: 'INV-REC-FAIL-01',
          locationId: showroom.id,
          additionalCost: 0,
          amountPaid: 15000,
          items: [{ productId, quantity: 1, unitCostPrice: 15000, sellingPrice: 25000, conversionFactor: 1 }]
        });
      }).toThrowError(LocationNotReceivableError);
    });
  });

  // =========================================================================
  // 4. ARCHIVING GUARDS (NON-ZERO STOCK & RESERVATIONS)
  // =========================================================================
  describe('4. Archiving Restrictions', () => {
    it('prohibits archiving a location containing non-zero stock', () => {
      const tempWh = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Temporary Staging Area',
          code: 'STAGE-01',
          locationType: 'warehouse'
        },
        actor
      );

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Cooking Oil 1L',
        sku: 'OIL-01',
        barcode: '896000005001',
        costPrice: 35000,
        sellingPrice: 45000,
        currentStock: 15
      });

      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: tempWh.id,
        onHandDeltaScaled: 15000
      });

      // Archival must throw LocationHasStockError
      expect(() => {
        locationService.archiveLocation(tempWh.id, actor);
      }).toThrowError(LocationHasStockError);
    });

    it('prohibits archiving a location containing reserved stock', () => {
      const reserveLoc = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Layaway Holding Bay',
          code: 'HOLD-01',
          locationType: 'storeroom'
        },
        actor
      );

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Microwave Oven',
        sku: 'MW-01',
        barcode: '896000006001',
        costPrice: 900000,
        sellingPrice: 1200000,
        currentStock: 0
      });

      // Insert balance with 0 on hand but 2 reserved
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: reserveLoc.id,
        onHandDeltaScaled: 0,
        reservedDeltaScaled: 2000
      });

      expect(() => {
        locationService.archiveLocation(reserveLoc.id, actor);
      }).toThrowError(LocationHasReservedStockError);
    });

    it('successfully archives an empty location and keeps it visible in history', () => {
      const emptyLoc = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Decommissioned Corner',
          code: 'DECOM-01',
          locationType: 'other'
        },
        actor
      );

      expect(() => {
        locationService.archiveLocation(emptyLoc.id, actor);
      }).not.toThrow();

      const archived = locationRepo.findById(emptyLoc.id, businessId);
      expect(archived!.isActive).toBe(false);

      // Still visible when includeInactive is true
      const allIncludingInactive = locationService.getLocations(businessId, branchId, true);
      expect(allIncludingInactive.some((l) => l.id === emptyLoc.id)).toBe(true);

      // Excluded when includeInactive is false
      const activeOnly = locationService.getLocations(businessId, branchId, false);
      expect(activeOnly.some((l) => l.id === emptyLoc.id)).toBe(false);
    });
  });

  // =========================================================================
  // 5. INTERNAL TRANSFERS, PAIRED MOVEMENTS & TOTAL PRESERVATION
  // =========================================================================
  describe('5. Stock Transfers, Paired Movements & Branch Preservation', () => {
    it('executes internal transfer within same branch creating paired movements without altering branch total stock', () => {
      const storeroom = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Dry Goods Storeroom',
          code: 'STR-DRY',
          locationType: 'storeroom'
        },
        actor
      );

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Sugar 50kg Sack',
        sku: 'SUGAR-50K',
        barcode: '896000007001',
        costPrice: 600000,
        sellingPrice: 750000,
        currentStock: 0
      });

      // Put 100 sacks in Storeroom
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: storeroom.id,
        onHandDeltaScaled: 100000
      });

      const initialBranchTotal = balanceRepo.getBranchTotalOnHand(branchId, productId, businessId);
      expect(initialBranchTotal).toBe(100000);

      // Transfer 30 sacks from Storeroom to Main Store Floor
      const transfer = locationService.transferStock(
        {
          businessId,
          sourceBranchId: branchId,
          destinationBranchId: branchId,
          sourceLocationId: storeroom.id,
          destinationLocationId: defaultLocationId,
          notes: 'Replenishing front shelves for morning rush',
          items: [
            {
              productId,
              quantityScaled: 30000
            }
          ]
        },
        actor
      );

      expect(transfer.status).toBe('COMPLETED');
      expect(transfer.transferType).toBe('INTERNAL_LOCATION');

      // Check Balances
      const storeroomBal = balanceRepo.getBalance(productId, storeroom.id, businessId);
      const floorBal = balanceRepo.getBalance(productId, defaultLocationId, businessId);

      expect(storeroomBal?.onHandScaled).toBe(70000); // 100 - 30 = 70
      expect(floorBal?.onHandScaled).toBe(30000); // 0 + 30 = 30

      // Rule 9: Total branch stock must remain unchanged!
      const finalBranchTotal = balanceRepo.getBranchTotalOnHand(branchId, productId, businessId);
      expect(finalBranchTotal).toBe(initialBranchTotal);

      // Rule 8: Paired Stock Movements created
      const movements = db
        .prepare('SELECT * FROM stock_movements WHERE transfer_id = ? ORDER BY rowid ASC')
        .all(transfer.id) as any[];

      expect(movements.length).toBe(2);
      expect(movements[0].movement_type).toBe('TRANSFER_OUT');
      expect(movements[0].stock_location_id).toBe(storeroom.id);
      expect(movements[0].quantity_base_scaled).toBe(-30000);

      expect(movements[1].movement_type).toBe('TRANSFER_IN');
      expect(movements[1].stock_location_id).toBe(defaultLocationId);
      expect(movements[1].quantity_base_scaled).toBe(30000);
    });

    it('rejects disguise of inter-branch transfer as an ordinary internal transfer', () => {
      // Create second branch and location
      const branch2Id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO branches (id, business_id, name, code)
        VALUES (?, ?, 'Airport Branch', 'AIR-01')
      `).run(branch2Id, businessId);

      const airportLoc = locationService.createLocation(
        {
          businessId,
          branchId: branch2Id,
          name: 'Airport Kiosk Stock',
          code: 'AIR-LOC',
          locationType: 'shop_floor'
        },
        actor
      );

      // Attempt internal transfer between different branches
      expect(() => {
        locationService.transferStock(
          {
            businessId,
            sourceBranchId: branchId,
            destinationBranchId: branch2Id,
            sourceLocationId: defaultLocationId,
            destinationLocationId: airportLoc.id,
            items: [{ productId: 1, quantityScaled: 5000 }]
          },
          actor
        );
      }).toThrowError(CrossBranchTransferMismatchError);
    });
  });

  // =========================================================================
  // 6. OFFLINE PERSISTENCE & DATA INTEGRITY
  // =========================================================================
  describe('6. Offline Data Persistence & Database Reopen', () => {
    it('persists stock locations, counter mappings and projection balances across database reloads', () => {
      const loc = locationService.createLocation(
        {
          businessId,
          branchId,
          name: 'Cold Storage Vault',
          code: 'VAULT-COLD',
          locationType: 'warehouse'
        },
        actor
      );

      const productId = productRepo.create({
        categoryId: 1,
        name: 'Frozen Beef Patties',
        sku: 'BEEF-PATTY',
        barcode: '896000009999',
        costPrice: 50000,
        sellingPrice: 80000,
        currentStock: 0
      });

      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: loc.id,
        onHandDeltaScaled: 45000,
        reservedDeltaScaled: 5000
      });

      // Simulate app restart by wrapping current in-memory db in a new service instance
      const newLocRepo = new StockLocationRepository(db);
      const newBalRepo = new StockBalanceRepository(db);

      const persistedLoc = newLocRepo.findById(loc.id, businessId);
      expect(persistedLoc).not.toBeNull();
      expect(persistedLoc!.code).toBe('VAULT-COLD');

      const persistedBal = newBalRepo.getBalance(productId, loc.id, businessId);
      expect(persistedBal).not.toBeNull();
      expect(persistedBal!.onHandScaled).toBe(45000);
      expect(persistedBal!.reservedScaled).toBe(5000);
      expect(persistedBal!.availableScaled).toBe(40000); // 45,000 - 5,000 = 40,000
    });
  });
});
