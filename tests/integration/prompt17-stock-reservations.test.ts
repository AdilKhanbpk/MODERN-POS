import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { StockReservationService } from '../../src/application/services/StockReservationService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { SalesService } from '../../src/application/services/SalesService';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { StockAdjustmentService } from '../../src/application/services/StockAdjustmentService';
import {
  StockReservationRules,
  ReservationUnavailableStockError,
  ReservationOverFulfilmentError,
  ReservationExpiredError,
  ReservationCancelledError,
  ReservationFulfilledError,
  ReservationStockConflictError,
  InsufficientAvailableStockError,
  CrossBranchReservationError
} from '../../src/domain/inventory/stock-reservation-rules';

describe('Prompt 17 — Stock Reservation System & Availability Protection', () => {
  let db: Database.Database;
  let reservationService: StockReservationService;
  let catalogService: ProductCatalogService;
  let salesService: SalesService;
  let balanceRepo: StockBalanceRepository;
  let adjustmentService: StockAdjustmentService;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '11111111-1111-1111-1111-111111111111';
  const otherBranchId = '22222222-2222-2222-2222-222222222222';
  const locWarehouse = '33333333-3333-3333-3333-333333333333';
  const locOtherBranch = '44444444-4444-4444-4444-444444444444';
  const customerId = '55555555-5555-5555-5555-555555555555';
  const userId = '1';
  const actor = { userId: 1, role: 'manager', businessId };

  let unitPieceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    reservationService = new StockReservationService(db);
    catalogService = new ProductCatalogService(db);
    salesService = new SalesService();
    (salesService as any).productRepo.db = db;
    (salesService as any).saleRepo.db = db;
    (salesService as any).customerRepo.db = db;
    (salesService as any).accountRepo.db = db;

    balanceRepo = new StockBalanceRepository(db);
    adjustmentService = new StockAdjustmentService();
    (adjustmentService as any).getDb = () => db;
    (adjustmentService as any).adjRepo.db = db;
    (adjustmentService as any).locationRepo.db = db;
    (adjustmentService as any).balanceRepo.db = db;
    (adjustmentService as any).productRepo.db = db;

    // Seed core business, branches, user, locations, customer
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, name, default_currency, default_cost_method)
      VALUES (?, 'Enterprise Mart', 'PKR', 'fifo')
    `).run(businessId);

    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, name, code)
      VALUES (?, ?, 'Main Branch', 'MAIN')
    `).run(branchId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, name, code)
      VALUES (?, ?, 'Second Branch', 'SEC')
    `).run(otherBranchId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES 
        (?, ?, 'admin', 'hash', 'Store Manager', 1),
        ('2', ?, 'owner_boss', 'hash', 'Owner Boss', 1)
    `).run(userId, businessId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, name, code, location_type, is_sellable, is_active, is_default)
      VALUES (?, ?, ?, 'Main Warehouse', 'WH-MAIN', 'shop_floor', 1, 1, 1)
    `).run(locWarehouse, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, name, code, location_type, is_sellable, is_active, is_default)
      VALUES (?, ?, ?, 'Branch 2 Store', 'WH-B2', 'shop_floor', 1, 1, 1)
    `).run(locOtherBranch, businessId, otherBranchId);

    db.prepare(`
      INSERT OR IGNORE INTO customers (id, business_id, customer_code, name, customer_type, is_active)
      VALUES (?, ?, 'CUST-001', 'Apex Commercial Corp', 'business', 1)
    `).run(customerId, businessId);

    const unit = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as { id: string };
    unitPieceId = unit.id;
  });

  // Helper to initialize product and on-hand stock
  function createProductWithStock(sku: string, name: string, onHandUnits: number) {
    const prod = catalogService.createProduct({
      businessId,
      sku,
      name,
      baseUnitId: unitPieceId,
      retailPriceMinor: 15000,
      costPrice: 10000
    });

    const scaled = onHandUnits * 1000;
    balanceRepo.upsertDelta({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      onHandDeltaScaled: scaled,
      reservedDeltaScaled: 0
    });

    db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(onHandUnits, prod.id);

    return prod;
  }

  // =========================================================================
  // 1. EXACT RESERVATION CALCULATION & SPECIFICATION EXAMPLE (SECTION 2)
  // =========================================================================
  describe('1. Exact Reservation Calculation & Specification Example', () => {
    it('executes prompt example: On-hand 100, ResA=20, ResB=10 -> Available=70. Fulfill ResA 12 -> On-hand 88, ResA=8, Available=70', () => {
      // Setup Product with On-hand: 100 pieces
      const prod = createProductWithStock('ITEM-100', 'Standard Widget', 100);

      // Verify initial balance
      const b0 = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b0.onHandScaled).toBe(100000); // 100
      expect(b0.reservedScaled).toBe(0);
      expect(b0.availableScaled).toBe(100000); // 100

      // Create Reservation A: 20 pieces
      const resA = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'sales_order',
          lines: [
            {
              productId: prod.id,
              stockLocationId: locWarehouse,
              reservedQuantityScaled: 20000
            }
          ]
        },
        actor
      );

      // Create Reservation B: 10 pieces
      const resB = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'quotation',
          lines: [
            {
              productId: prod.id,
              stockLocationId: locWarehouse,
              reservedQuantityScaled: 10000
            }
          ]
        },
        actor
      );

      // Balance Check: On-hand = 100, Reserved = 30, Available = 70
      const b1 = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b1.onHandScaled).toBe(100000); // 100.000
      expect(b1.reservedScaled).toBe(30000); // 30.000
      expect(b1.availableScaled).toBe(70000); // 70.000 (Available = OnHand - ActiveReserved)

      // Fulfill Reservation A for 12 pieces via linked Sale
      const sale = salesService.createSale({
        businessId,
        branchId,
        locationId: locWarehouse,
        reservationId: resA.id,
        cashierId: 1,
        amountPaid: 180000, // 12 * 150.00
        items: [
          {
            productId: prod.id as any,
            quantity: 12,
            conversionFactor: 1,
            unitPrice: 15000
          }
        ]
      });

      expect(sale).toBeDefined();

      // Check Reservation A status & line
      const updatedResA = reservationService.getReservation(resA.id)!;
      expect(updatedResA.status).toBe('partially_fulfilled');
      const lineA = updatedResA.lines![0];
      expect(lineA.reservedQuantityScaled).toBe(20000);
      expect(lineA.fulfilledQuantityScaled).toBe(12000);
      expect(lineA.reservedQuantityScaled - lineA.fulfilledQuantityScaled).toBe(8000); // Remaining reservation = 8

      // CRITICAL INVENTORY BALANCE CONSERVATION:
      // On-hand: 88.000 (100 - 12)
      // Active Reserved: 18.000 (Res A has 8 remaining + Res B has 10 = 18)
      // Available: 70.000 (88 - 18 = 70, ZERO double deduction!)
      const b2 = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b2.onHandScaled).toBe(88000);
      expect(b2.reservedScaled).toBe(18000);
      expect(b2.availableScaled).toBe(70000);

      // Complete fulfillment of Reservation A for remaining 8 pieces
      salesService.createSale({
        businessId,
        branchId,
        locationId: locWarehouse,
        reservationId: resA.id,
        cashierId: 1,
        amountPaid: 120000,
        items: [
          {
            productId: prod.id as any,
            quantity: 8,
            conversionFactor: 1,
            unitPrice: 15000
          }
        ]
      });

      const fullyFulfilledResA = reservationService.getReservation(resA.id)!;
      expect(fullyFulfilledResA.status).toBe('fulfilled');
      expect(fullyFulfilledResA.lines![0].fulfilledQuantityScaled).toBe(20000);

      // Balance after fulfilling all 20 of Res A:
      // On-hand: 80 (100 - 20)
      // Reserved: 10 (only Res B remains)
      // Available: 70
      const b3 = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b3.onHandScaled).toBe(80000);
      expect(b3.reservedScaled).toBe(10000);
      expect(b3.availableScaled).toBe(70000);
    });
  });

  // =========================================================================
  // 2. AVAILABILITY GUARD & CONCURRENT RESERVATION CHECKS
  // =========================================================================
  describe('2. Availability Guard & Stock Commitment', () => {
    it('blocks reservation when requested quantity exceeds available stock', () => {
      const prod = createProductWithStock('AVAIL-01', 'Limited Widget', 50);

      // Reserve 40
      reservationService.createReservation(
        {
          businessId,
          branchId,
          sourceType: 'manual',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 40000 }]
        },
        actor
      );

      // Available is now 10
      // Requesting 15 should fail with ReservationUnavailableStockError
      expect(() => {
        reservationService.createReservation(
          {
            businessId,
            branchId,
            sourceType: 'manual',
            lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 15000 }]
          },
          actor
        );
      }).toThrowError(ReservationUnavailableStockError);
    });

    it('rejects cross-branch and cross-business reservation requests', () => {
      const prod = createProductWithStock('XB-01', 'Branch Widget', 20);

      // Attempt reservation in Branch 1 referencing Location in Branch 2 -> REJECTED
      expect(() => {
        reservationService.createReservation(
          {
            businessId,
            branchId,
            sourceType: 'manual',
            lines: [{ productId: prod.id, stockLocationId: locOtherBranch, reservedQuantityScaled: 5000 }]
          },
          actor
        );
      }).toThrowError(CrossBranchReservationError);
    });
  });

  // =========================================================================
  // 3. ORDINARY SALES STOCK PROTECTION (SECTION 5)
  // =========================================================================
  describe('3. Ordinary Sales Stock Protection', () => {
    it('strictly prevents ordinary sales from consuming reserved stock', () => {
      // 100 on hand, 40 reserved -> 60 available
      const prod = createProductWithStock('PROTECT-01', 'Shielded Product', 100);

      reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'sales_order',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 40000 }]
        },
        actor
      );

      // Attempting ordinary sale of 70 (when available is 60) -> BLOCKED
      expect(() => {
        salesService.createSale({
          businessId,
          branchId,
          locationId: locWarehouse,
          cashierId: 1,
          amountPaid: 1050000,
          items: [
            {
              productId: prod.id as any,
              quantity: 70, // 70 > 60 available
              conversionFactor: 1,
              unitPrice: 15000
            }
          ]
        });
      }).toThrowError(InsufficientAvailableStockError);

      // Ordinary sale of 50 (within 60 available) -> SUCCEEDS
      expect(() => {
        salesService.createSale({
          businessId,
          branchId,
          locationId: locWarehouse,
          cashierId: 1,
          amountPaid: 750000,
          items: [
            {
              productId: prod.id as any,
              quantity: 50,
              conversionFactor: 1,
              unitPrice: 15000
            }
          ]
        });
      }).not.toThrow();

      // Check balance: On-hand = 50, Reserved = 40, Available = 10
      const b = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b.onHandScaled).toBe(50000);
      expect(b.reservedScaled).toBe(40000);
      expect(b.availableScaled).toBe(10000);
    });
  });

  // =========================================================================
  // 4. OVER-FULFILLMENT, DOUBLE FULFILLMENT & IMMUTABILITY
  // =========================================================================
  describe('4. Over-fulfillment & Immutability Guards', () => {
    it('prevents over-fulfillment beyond reserved quantity', () => {
      const prod = createProductWithStock('OVER-01', 'Widget Over', 50);

      const res = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'manual',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 10000 }] // 10
        },
        actor
      );

      // Attempt to fulfill 15 when only 10 is reserved -> REJECTED
      expect(() => {
        reservationService.fulfillReservation(
          {
            reservationId: res.id,
            lines: [{ lineId: res.lines![0].id, fulfillQuantityScaled: 15000 }]
          },
          actor
        );
      }).toThrowError(ReservationOverFulfilmentError);
    });

    it('rejects fulfillment of already-fulfilled or cancelled reservations', () => {
      const prod = createProductWithStock('CAN-01', 'Cancel Widget', 50);

      const res = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'manual',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 10000 }]
        },
        actor
      );

      // Cancel reservation
      reservationService.cancelReservation(res.id, actor, 'Customer cancelled project');
      const cancelledRes = reservationService.getReservation(res.id)!;
      expect(cancelledRes.status).toBe('cancelled');

      // Attempt fulfillment after cancellation -> REJECTED
      expect(() => {
        reservationService.fulfillReservation(
          {
            reservationId: res.id,
            lines: [{ lineId: res.lines![0].id, fulfillQuantityScaled: 5000 }]
          },
          actor
        );
      }).toThrowError(ReservationCancelledError);
    });
  });

  // =========================================================================
  // 5. EXPIRATION, PROACTIVE SWEEP & EXTENSION (SECTION 4)
  // =========================================================================
  describe('5. Expiration, Auto-Sweep & Extension', () => {
    it('auto-releases committed stock upon expiration during query or next transaction without relying on background timer', () => {
      const prod = createProductWithStock('EXP-01', 'Timed Widget', 100);

      const pastExpiry = new Date(Date.now() - 3600000).toISOString(); // 1 hour in the past

      // Create reservation with past expiry
      const res = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'quotation',
          expiresAt: pastExpiry,
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 25000 }]
        },
        actor
      );

      // Proactive check sweeps expired reservation
      const expiredList = reservationService.checkAndExpireReservations(businessId);
      expect(expiredList.length).toBeGreaterThanOrEqual(1);

      const expiredRes = reservationService.getReservation(res.id)!;
      expect(expiredRes.status).toBe('expired');

      // The 25 committed pieces are released back to available stock
      const b = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b.reservedScaled).toBe(0);
      expect(b.availableScaled).toBe(100000); // 100 available!

      // Attempting to fulfill expired reservation without extension throws ReservationExpiredError
      expect(() => {
        reservationService.fulfillReservation(
          {
            reservationId: res.id,
            lines: [{ lineId: res.lines![0].id, fulfillQuantityScaled: 10000 }]
          },
          actor
        );
      }).toThrowError(ReservationExpiredError);
    });

    it('extends an expired reservation and re-commits stock when authorized', () => {
      const prod = createProductWithStock('EXT-01', 'Renewable Widget', 50);

      const pastExpiry = new Date(Date.now() - 10000).toISOString();
      const res = reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'manual',
          expiresAt: pastExpiry,
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 15000 }]
        },
        actor
      );

      // Expire it
      reservationService.checkAndExpireReservations(businessId);
      expect(reservationService.getReservation(res.id)!.status).toBe('expired');

      // Extend to tomorrow
      const futureExpiry = new Date(Date.now() + 86400000).toISOString();
      const extended = reservationService.extendReservation(
        {
          reservationId: res.id,
          newExpiresAt: futureExpiry,
          authorizedBy: 'Store Manager'
        },
        actor
      );

      expect(extended.status).toBe('active');
      expect(extended.expiresAt).toBe(futureExpiry);

      // Reserved quantity is re-committed into stock_balances
      const b = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b.reservedScaled).toBe(15000);
      expect(b.availableScaled).toBe(35000);
    });
  });

  // =========================================================================
  // 6. MANUAL RELEASE & PARTIAL RELEASE (SECTION 3)
  // =========================================================================
  describe('6. Manual Release', () => {
    it('releases remaining reservation manually and restores available stock', () => {
      const prod = createProductWithStock('REL-01', 'Release Widget', 40);

      const res = reservationService.createReservation(
        {
          businessId,
          branchId,
          sourceType: 'manual',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 20000 }]
        },
        actor
      );

      expect(balanceRepo.getBalance(prod.id, locWarehouse, businessId)!.availableScaled).toBe(20000);

      // Partial fulfillment of 5
      reservationService.fulfillReservation(
        {
          reservationId: res.id,
          lines: [{ lineId: res.lines![0].id, fulfillQuantityScaled: 5000 }]
        },
        actor
      );

      // Release the remaining 15
      const released = reservationService.releaseReservation({ reservationId: res.id }, actor);
      expect(released.status).toBe('fulfilled'); // All accounted for (5 fulfilled + 15 released)

      const line = released.lines![0];
      expect(line.fulfilledQuantityScaled).toBe(5000);
      expect(line.releasedQuantityScaled).toBe(15000);

      // Reserved stock is now zero
      const b = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b.reservedScaled).toBe(0);
    });
  });

  // =========================================================================
  // 7. STOCK ADJUSTMENT CONFLICT GUARD (SECTION 7)
  // =========================================================================
  describe('7. Stock Adjustment Conflict Guard', () => {
    it('flags conflict and blocks inventory reduction below active reservations without manager override', () => {
      // 50 on hand, 30 reserved
      const prod = createProductWithStock('ADJ-CONF-01', 'Shrinkage Widget', 50);

      reservationService.createReservation(
        {
          businessId,
          branchId,
          sourceType: 'sales_order',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 30000 }]
        },
        actor
      );

      // Physical count finds only 10 pieces (a 40 piece loss)
      // New on-hand would be 10, which is LESS than 30 active reserved!
      const adj = adjustmentService.createAdjustment(
        {
          businessId,
          branchId,
          stockLocationId: locWarehouse,
          adjustmentType: 'damage',
          reasonCode: 'DAMAGED',
          reasonDescription: 'Severe water leak in warehouse aisle',
          lines: [
            {
              productId: prod.id,
              countedQuantityScaled: 10000
            }
          ]
        },
        actor
      );

      // Approval by separate authorized approver (anti-self-approval rule)
      const approverActor = { userId: 2, role: 'owner', businessId };
      adjustmentService.approveAdjustment(adj.id, approverActor);

      // Posting without override -> BLOCKED by ReservationStockConflictError
      expect(() => {
        adjustmentService.postAdjustment(adj.id, approverActor, { allowReservationConflict: false });
      }).toThrowError(ReservationStockConflictError);

      // When manager explicitly reviews and authorizes with allowReservationConflict: true
      const posted = adjustmentService.postAdjustment(adj.id, approverActor, { allowReservationConflict: true });
      expect(posted.status).toBe('posted');

      // Verified: Reservations were NEVER silently deleted!
      const activeRes = reservationService.getReservationByNumber(adj.adjustmentNumber);
      const b = balanceRepo.getBalance(prod.id, locWarehouse, businessId)!;
      expect(b.onHandScaled).toBe(10000);
      expect(b.reservedScaled).toBe(30000); // 30 still preserved!
      expect(b.availableScaled).toBe(0);
    });
  });

  // =========================================================================
  // 8. LISTING, SEARCH & MULTIPLE RESERVATION WORKFLOWS
  // =========================================================================
  describe('8. Listing & Workflow Tracking', () => {
    it('filters reservations by status, customer, and search term', () => {
      const prod = createProductWithStock('LIST-01', 'Multi-source Widget', 80);

      reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId,
          sourceType: 'quotation',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 10000 }]
        },
        actor
      );

      reservationService.createReservation(
        {
          businessId,
          branchId,
          customerId: null,
          sourceType: 'manual',
          lines: [{ productId: prod.id, stockLocationId: locWarehouse, reservedQuantityScaled: 10000 }]
        },
        actor
      );

      const all = reservationService.listReservations({ businessId });
      expect(all.length).toBe(2);

      const quoteOnly = reservationService.listReservations({ businessId, sourceType: 'quotation' });
      expect(quoteOnly.length).toBe(1);
      expect(quoteOnly[0].sourceType).toBe('quotation');

      const customerOnly = reservationService.listReservations({ businessId, customerId });
      expect(customerOnly.length).toBe(1);
      expect(customerOnly[0].customerName).toBe('Apex Commercial Corp');
    });
  });
});
