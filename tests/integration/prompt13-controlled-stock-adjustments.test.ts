import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { setDatabase } from '../../src/infrastructure/sqlite/connection';
import { StockAdjustmentService } from '../../src/application/services/StockAdjustmentService';
import { StockAdjustmentRepository } from '../../src/infrastructure/sqlite/repositories/StockAdjustmentRepository';
import { StockLocationRepository } from '../../src/infrastructure/sqlite/repositories/StockLocationRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import {
  InvalidPhysicalCountError,
  InvalidAdjustmentReasonError,
  SelfApprovalDisallowedError,
  UnauthorizedApproverError,
  StockDriftConflictError,
  AdjustmentAlreadyPostedError
} from '../../src/domain/inventory/stock-adjustment-rules';
import { LocationNotSellableError, StockLocationRules } from '../../src/domain/inventory/stock-location-rules';

describe('Prompt 13 — Controlled Stock-Adjustment System & Damage Controls', () => {
  let db: Database.Database;
  let adjService: StockAdjustmentService;
  let adjRepo: StockAdjustmentRepository;
  let locationRepo: StockLocationRepository;
  let balanceRepo: StockBalanceRepository;
  let productRepo: ProductRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const defaultLocId = '00000000-0000-0000-0000-000000000004'; // Main Store Floor (is_sellable = 1)

  const ownerActor = { userId: '1', role: 'OWNER', businessId, branchId };
  const managerActor = { userId: '2', role: 'MANAGER', businessId, branchId };
  const cashierActor = { userId: '3', role: 'CASHIER', businessId, branchId };

  let damagedLocationId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDatabase(db);
    runMigrations(db);

    // Seed Manager and Cashier users for testing
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES ('2', '00000000-0000-0000-0000-000000000001', 'manager_alice', 'hash', 'Manager Alice', 1)
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES ('3', '00000000-0000-0000-0000-000000000001', 'cashier_bob', 'hash', 'Cashier Bob', 1)
    `).run();

    adjRepo = new StockAdjustmentRepository(db);
    locationRepo = new StockLocationRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    productRepo = new ProductRepository(db);

    adjService = new StockAdjustmentService(adjRepo, locationRepo, balanceRepo, productRepo);

    // Create a dedicated Damaged stock location (is_sellable = 0)
    const damagedLoc = locationRepo.create(
      {
        businessId,
        branchId,
        name: 'Damaged Goods Quarantine',
        code: 'DMG-ROOM-01',
        locationType: 'damaged',
        isSellable: false,
        isReceivable: true
      },
      '1'
    );
    damagedLocationId = damagedLoc.id;
  });

  afterEach(() => {
    setDatabase(null);
    db.close();
  });

  // =========================================================================
  // 1. ADJUSTMENT CALCULATION: Difference = CountedQuantity - SystemQuantity
  // =========================================================================
  describe('1. Adjustment Calculation & Normalization', () => {
    it('calculates negative difference (decrease): System 100, Counted 93 -> Diff -7', () => {
      // 1. Create product with initial stock 100
      const productId = productRepo.create({
        businessId,
        name: 'Organic Honey 500g',
        sku: 'HONEY-500G',
        barcode: '112233445501',
        currentStock: 100,
        costPrice: 40000 // Rs. 400.00
      });

      // 2. Perform adjustment: Counted 93
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'decrease',
          reasonCode: 'MISSING',
          reasonDescription: 'Discrepancy identified during weekly audit in shelf B',
          autoPostIfPermitted: true,
          lines: [
            {
              productId,
              countedQuantityScaled: 93 * 1000,
              unitCostMinor: 40000
            }
          ]
        },
        ownerActor
      );

      expect(adj.status).toBe('posted');
      expect(adj.lines[0].systemQuantityScaled).toBe(100 * 1000);
      expect(adj.lines[0].countedQuantityScaled).toBe(93 * 1000);
      expect(adj.lines[0].differenceQuantityScaled).toBe(-7 * 1000);
      expect(adj.lines[0].totalValueMinor).toBe(-7 * 40000);

      // Verify authoritative balance projection updated to 93
      const bal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(bal?.onHandScaled).toBe(93 * 1000);
    });

    it('calculates positive difference (increase): System 50, Counted 54 -> Diff +4', () => {
      // 1. Create product with initial stock 50
      const productId = productRepo.create({
        businessId,
        name: 'Almond Milk 1L',
        sku: 'MILK-ALMOND-1L',
        barcode: '112233445502',
        currentStock: 50,
        costPrice: 25000 // Rs. 250.00
      });

      // 2. Perform adjustment: Counted 54
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'increase',
          reasonCode: 'FOUND_STOCK',
          reasonDescription: 'Found 4 unrecorded cartons behind primary pallet',
          autoPostIfPermitted: true,
          lines: [
            {
              productId,
              countedQuantityScaled: 54 * 1000,
              unitCostMinor: 25000
            }
          ]
        },
        ownerActor
      );

      expect(adj.status).toBe('posted');
      expect(adj.lines[0].systemQuantityScaled).toBe(50 * 1000);
      expect(adj.lines[0].countedQuantityScaled).toBe(54 * 1000);
      expect(adj.lines[0].differenceQuantityScaled).toBe(4 * 1000);

      // Verify balance updated to 54
      const bal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(bal?.onHandScaled).toBe(54 * 1000);
    });

    it('strictly rejects negative counted stock with InvalidPhysicalCountError', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Cooking Oil 5L',
        sku: 'OIL-5L',
        barcode: '112233445503',
        currentStock: 10
      });

      expect(() => {
        adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'decrease',
            reasonCode: 'MISSING',
            reasonDescription: 'Audit count',
            lines: [
              {
                productId,
                countedQuantityScaled: -5000
              }
            ]
          },
          ownerActor
        );
      }).toThrowError(InvalidPhysicalCountError);
    });
  });

  // =========================================================================
  // 2. REASON CODES & MANDATORY DESCRIPTIONS
  // =========================================================================
  describe('2. Reason Codes & Validations', () => {
    it('accepts all standard reason codes with descriptive text', () => {
      const prodId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-01', currentStock: 10 });
      const standardCodes = [
        'DAMAGED',
        'EXPIRED',
        'MISSING',
        'THEFT',
        'BROKEN',
        'FOUND_STOCK',
        'DATA_CORRECTION',
        'OPENING_BALANCE_CORRECTION'
      ];

      for (const code of standardCodes) {
        const adj = adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'correction',
            reasonCode: code as any,
            reasonDescription: `Valid reason verification for ${code}`,
            lines: [{ productId: prodId, countedQuantityScaled: 10000 }]
          },
          ownerActor
        );
        expect(adj.reasonCode).toBe(code);
      }
    });

    it('requires minimum 5 characters description when reason code is OTHER', () => {
      const prodId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-02', currentStock: 10 });

      expect(() => {
        adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'other',
            reasonCode: 'OTHER',
            reasonDescription: 'bad', // only 3 chars -> invalid
            lines: [{ productId: prodId, countedQuantityScaled: 10000 }]
          },
          ownerActor
        );
      }).toThrowError(InvalidAdjustmentReasonError);
    });

    it('rejects unrecognized / invented reason codes', () => {
      const prodId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-03', currentStock: 10 });

      expect(() => {
        adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'other',
            reasonCode: 'MAGIC_DISAPPEARANCE' as any,
            reasonDescription: 'Something vanished into thin air',
            lines: [{ productId: prodId, countedQuantityScaled: 10000 }]
          },
          ownerActor
        );
      }).toThrowError(InvalidAdjustmentReasonError);
    });
  });

  // =========================================================================
  // 3. APPROVAL RULES & SELF-APPROVAL GUARDS
  // =========================================================================
  describe('3. Approval Rules & Managerial Controls', () => {
    it('routes cashier adjustment to pending_approval when exceeding threshold', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Expensive Basmati Rice 25kg',
        sku: 'RICE-25KG',
        barcode: '112233445504',
        currentStock: 20,
        costPrice: 500000 // Rs. 5,000.00
      });

      // Cashier submits adjustment with difference of -6 units (exceeds default 5 units threshold)
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'decrease',
          reasonCode: 'MISSING',
          reasonDescription: 'Counted 14 bags instead of 20 bags on floor',
          autoPostIfPermitted: true,
          lines: [{ productId, countedQuantityScaled: 14 * 1000, unitCostMinor: 500000 }]
        },
        cashierActor
      );

      // Status must be pending_approval because cashier cannot auto-approve and diff > threshold
      expect(adj.status).toBe('pending_approval');
      expect(adj.approvedBy).toBeNull();
      expect(adj.postedBy).toBeNull();

      // Ensure stock has NOT been changed yet
      const bal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(bal?.onHandScaled).toBe(20 * 1000);
    });

    it('prevents requester from approving their own adjustment unless policy allows', () => {
      const productId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-04', currentStock: 10 });

      // Manager requests adjustment
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'damage',
          reasonCode: 'DAMAGED',
          reasonDescription: 'Leaking container on shelf',
          lines: [{ productId, countedQuantityScaled: 8 * 1000 }]
        },
        managerActor
      );

      expect(adj.status).toBe('pending_approval');

      // Manager attempts to self-approve
      expect(() => {
        adjService.approveAdjustment(adj.id, managerActor);
      }).toThrowError(SelfApprovalDisallowedError);

      // Owner approves -> succeeds
      const approved = adjService.approveAdjustment(adj.id, ownerActor);
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe(ownerActor.userId);
    });

    it('rejecting a pending adjustment marks it rejected and prevents inventory movement', () => {
      const productId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-05', currentStock: 10 });

      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'decrease',
          reasonCode: 'MISSING',
          reasonDescription: 'Missing 5 units',
          lines: [{ productId, countedQuantityScaled: 5 * 1000 }]
        },
        cashierActor
      );

      const rejected = adjService.rejectAdjustment(adj.id, 'Discrepancy resolved; items found in backroom', managerActor);
      expect(rejected.status).toBe('rejected');

      // Attempt to post a rejected adjustment fails
      expect(() => {
        adjService.postAdjustment(adj.id, ownerActor);
      }).toThrowError(/Cannot post adjustment with status 'rejected'/);

      // Stock remains intact
      const bal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(bal?.onHandScaled).toBe(10 * 1000);
    });
  });

  // =========================================================================
  // 4. CONCURRENCY & DRIFT DETECTION (STOCK CHANGED WHILE DRAFTING)
  // =========================================================================
  describe('4. Stock Drift Detection', () => {
    it('detects concurrent stock changes and requires user refresh / re-confirmation', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Sparkling Mineral Water',
        sku: 'WATER-SPARK-1L',
        barcode: '112233445506',
        currentStock: 100
      });

      // 1. Auditor drafts an adjustment: Counted 95 (diff = -5)
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'correction',
          reasonCode: 'BROKEN',
          reasonDescription: '5 bottles shattered on floor',
          lines: [{ productId, countedQuantityScaled: 95 * 1000 }]
        },
        managerActor
      );

      expect(adj.lines[0].systemQuantityScaled).toBe(100 * 1000);

      // 2. Concurrently, a POS cashier completes a sale of 10 bottles -> stock drops to 90
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: defaultLocId,
        onHandDeltaScaled: -10 * 1000
      });

      // Manager approves adjustment
      adjService.approveAdjustment(adj.id, ownerActor);

      // 3. Attempting to post without refreshing snapshot throws StockDriftConflictError
      expect(() => {
        adjService.postAdjustment(adj.id, ownerActor, { forceRefreshSnapshot: false });
      }).toThrowError(StockDriftConflictError);

      // 4. Auditor reviews, confirms refresh: forceRefreshSnapshot = true
      // Recalculates difference against current 90: Counted 95 - System 90 = +5
      const posted = adjService.postAdjustment(adj.id, ownerActor, { forceRefreshSnapshot: true });
      expect(posted.status).toBe('posted');
      expect(posted.lines[0].systemQuantityScaled).toBe(90 * 1000);
      expect(posted.lines[0].differenceQuantityScaled).toBe(5 * 1000);

      // Final inventory is 95
      const finalBal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(finalBal?.onHandScaled).toBe(95 * 1000);
    });
  });

  // =========================================================================
  // 5. NEGATIVE STOCK GUARDS
  // =========================================================================
  describe('5. Negative Stock Restrictions', () => {
    it('blocks adjustment decrease that would drive product stock negative when disallowed', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Fresh Dairy Yogurt 500g',
        sku: 'YOGURT-500G',
        barcode: '112233445507',
        currentStock: 5,
        allowNegativeStock: false
      });

      // Attempt to decrease by 10 units when current stock is only 5
      // Difference = 0 - 5 = -5; but if balance changed or user counted 0, -5 is allowed.
      // What if current balance is 5, but between draft and post, stock dropped to 2:
      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'decrease',
          reasonCode: 'EXPIRED',
          reasonDescription: 'Expired yogurt batch removal',
          lines: [{ productId, countedQuantityScaled: 0 }] // -5 decrease
        },
        ownerActor
      );

      // Concurrent deduction of 4 units leaves on hand = 1
      balanceRepo.upsertDelta({
        businessId,
        productId,
        stockLocationId: defaultLocId,
        onHandDeltaScaled: -4 * 1000
      });

      // Attempting to decrease by 5 when remaining is only 1 would drop stock to -4 -> rejected
      expect(() => {
        adjService.postAdjustment(adj.id, ownerActor, { forceRefreshSnapshot: true });
      }).toThrowError(/would drive product 'Fresh Dairy Yogurt 500g' stock negative/);
    });
  });

  // =========================================================================
  // 6. IMMUTABILITY OF POSTED ADJUSTMENTS & REVERSALS
  // =========================================================================
  describe('6. Immutability & Reversals', () => {
    it('prohibits editing, deleting, or re-posting a posted adjustment', () => {
      const productId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-06', currentStock: 20 });

      const adj = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'decrease',
          reasonCode: 'MISSING',
          reasonDescription: 'Audit count',
          autoPostIfPermitted: true,
          lines: [{ productId, countedQuantityScaled: 18 * 1000 }]
        },
        ownerActor
      );

      expect(adj.status).toBe('posted');

      // Attempt to re-post
      expect(() => {
        adjService.postAdjustment(adj.id, ownerActor);
      }).toThrowError(AdjustmentAlreadyPostedError);

      // Attempt to cancel
      expect(() => {
        adjService.cancelAdjustment(adj.id, ownerActor);
      }).toThrowError(/Cannot transition stock adjustment from 'posted' to 'cancelled'/);
    });

    it('creates an audited compensating reversal for a posted adjustment', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Olive Oil Extra Virgin 1L',
        sku: 'OIL-OLIVE-1L',
        barcode: '112233445508',
        currentStock: 30,
        costPrice: 150000 // Rs. 1,500.00
      });

      // 1. Post original adjustment: decrease by 5 (30 -> 25)
      const original = adjService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: defaultLocId,
          adjustmentType: 'correction',
          reasonCode: 'BROKEN',
          reasonDescription: 'Incorrectly reported as broken by cleaning staff',
          autoPostIfPermitted: true,
          lines: [{ productId, countedQuantityScaled: 25 * 1000, unitCostMinor: 150000 }]
        },
        ownerActor
      );

      expect(balanceRepo.getBalance(productId, defaultLocId, businessId, null)?.onHandScaled).toBe(25 * 1000);

      // 2. Perform reversal
      const reversal = adjService.reverseAdjustment(
        original.id,
        'Bottles were intact in storeroom annex; reversing previous write-off',
        ownerActor
      );

      expect(reversal.status).toBe('posted');
      expect(reversal.reversalOfId).toBe(original.id);
      expect(reversal.lines[0].differenceQuantityScaled).toBe(5 * 1000); // opposite direction: +5

      // 3. Verify stock is perfectly restored to 30
      const restoredBal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(restoredBal?.onHandScaled).toBe(30 * 1000);
    });
  });

  // =========================================================================
  // 7. DAMAGED STOCK: RELOCATION, POS ISOLATION, WRITE-OFF & RESTORATION
  // =========================================================================
  describe('7. Damaged and Expired Stock Lifecycle', () => {
    it('relocates usable stock to damaged quarantine; ensures POS cannot sell damaged stock', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Ceramic Dinner Plate',
        sku: 'PLATE-CERAMIC-01',
        barcode: '112233445509',
        currentStock: 40,
        costPrice: 50000,
        sellingPrice: 85000
      });

      // 1. Relocate 6 cracked plates from Main Floor to Damaged Quarantine
      const relocResult = adjService.relocateToDamaged(
        {
          businessId,
          branchId,
          productId,
          fromLocationId: defaultLocId,
          toDamagedLocationId: damagedLocationId,
          quantityScaled: 6 * 1000,
          reasonDescription: 'Hairline cracks discovered during restocking'
        },
        managerActor
      );

      expect(relocResult.quantityScaled).toBe(6 * 1000);

      // Main Floor stock is now 34
      const floorBal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(floorBal?.onHandScaled).toBe(34 * 1000);

      // Damaged Quarantine stock is now 6
      const damagedBal = balanceRepo.getBalance(productId, damagedLocationId, businessId, null);
      expect(damagedBal?.onHandScaled).toBe(6 * 1000);

      // 2. Total company stock remains 40 (physical plates still exist)
      expect(floorBal!.onHandScaled + damagedBal!.onHandScaled).toBe(40 * 1000);

      // 3. POS Attempt to sell from damaged location MUST FAIL (LocationNotSellableError)
      expect(() => {
        const damagedLoc = locationRepo.findById(damagedLocationId);
        StockLocationRules.validateSellable({
          name: damagedLoc!.name,
          isActive: damagedLoc!.isActive,
          isSellable: damagedLoc!.isSellable,
          locationType: damagedLoc!.locationType
        });
      }).toThrowError(LocationNotSellableError);
    });

    it('writes off damaged stock permanently, decreasing company inventory and posting DAMAGE_WRITEOFF movement', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Glass Tumbler 6-pack',
        sku: 'GLASS-TUMB-06',
        barcode: '112233445510',
        currentStock: 15
      });

      // Move 4 to damaged first
      adjService.relocateToDamaged(
        {
          businessId,
          branchId,
          productId,
          fromLocationId: defaultLocId,
          toDamagedLocationId: damagedLocationId,
          quantityScaled: 4 * 1000,
          reasonDescription: 'Shattered glasses'
        },
        managerActor
      );

      // Authorized write-off from damaged location
      const writeoffResult = adjService.writeOffDamaged(
        {
          businessId,
          branchId,
          productId,
          stockLocationId: damagedLocationId,
          quantityScaled: 4 * 1000,
          reasonDescription: 'Disposed into safe glass recycling bin'
        },
        ownerActor
      );

      expect(writeoffResult.status).toBe('WRITTEN_OFF');

      // Damaged location balance is now 0
      const damagedBal = balanceRepo.getBalance(productId, damagedLocationId, businessId, null);
      expect(damagedBal?.onHandScaled).toBe(0);

      // Floor balance remains 11
      const floorBal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(floorBal?.onHandScaled).toBe(11 * 1000);
    });

    it('returns inspected stock from damaged location back into sellable stock floor', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Wireless Bluetooth Earbuds',
        sku: 'EARBUDS-BT-01',
        barcode: '112233445511',
        currentStock: 10
      });

      // 1. Relocate 2 suspect units to quarantine
      adjService.relocateToDamaged(
        {
          businessId,
          branchId,
          productId,
          fromLocationId: defaultLocId,
          toDamagedLocationId: damagedLocationId,
          quantityScaled: 2 * 1000,
          reasonDescription: 'Customer opened box, suspected missing charging cable'
        },
        managerActor
      );

      // 2. Manager inspects: cable was inside lower cardboard compartment. Return 2 units to sellable floor.
      const returnResult = adjService.returnToSellable(
        {
          businessId,
          branchId,
          productId,
          fromDamagedLocationId: damagedLocationId,
          toSellableLocationId: defaultLocId,
          quantityScaled: 2 * 1000,
          reasonDescription: 'Inspected by QA manager; package complete and undamaged'
        },
        managerActor
      );

      expect(returnResult.quantityScaled).toBe(2 * 1000);

      // Damaged quarantine is back to 0
      const damagedBal = balanceRepo.getBalance(productId, damagedLocationId, businessId, null);
      expect(damagedBal?.onHandScaled).toBe(0);

      // Sellable floor is back to full 10 units
      const floorBal = balanceRepo.getBalance(productId, defaultLocId, businessId, null);
      expect(floorBal?.onHandScaled).toBe(10 * 1000);
    });
  });

  // =========================================================================
  // 8. CROSS-BUSINESS ISOLATION & ARCHIVED PRODUCT GUARDS
  // =========================================================================
  describe('8. Multi-Tenant Isolation & Archival Guards', () => {
    it('strictly forbids creating stock adjustments for inactive or archived products', () => {
      const productId = productRepo.create({
        businessId,
        name: 'Discontinued Juice',
        sku: 'JUICE-DISCONT',
        currentStock: 10,
        isActive: false
      });

      expect(() => {
        adjService.createAdjustment(
          {
            businessId,
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'correction',
            reasonCode: 'DATA_CORRECTION',
            reasonDescription: 'Try adjust archived product',
            lines: [{ productId, countedQuantityScaled: 15 * 1000 }]
          },
          ownerActor
        );
      }).toThrowError(/Cannot adjust stock for archived or inactive product/);
    });

    it('rejects cross-business adjustment requests', () => {
      const foreignBiz = '99999999-9999-9999-9999-999999999999';
      const prodId = productRepo.create({ businessId, name: 'Item', sku: 'ITEM-07', currentStock: 10 });

      expect(() => {
        adjService.createAdjustment(
          {
            businessId: foreignBiz, // Mismatched business
            branchId,
            stockLocationId: defaultLocId,
            adjustmentType: 'correction',
            reasonCode: 'DATA_CORRECTION',
            reasonDescription: 'Cross-business attempt',
            lines: [{ productId: prodId, countedQuantityScaled: 12 * 1000 }]
          },
          { userId: '1', role: 'OWNER', businessId: foreignBiz }
        );
      }).toThrowError(/Cross-business access denied/);
    });
  });
});
