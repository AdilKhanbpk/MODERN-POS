import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { StockReplenishmentService } from '../../src/application/services/StockReplenishmentService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { StockReservationService } from '../../src/application/services/StockReservationService';
import { UnitConversionService } from '../../src/application/services/UnitConversionService';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import {
  ReplenishmentRuleValidationError,
  TargetStockBelowMinimumError,
  InactiveSupplierReplenishmentError
} from '../../src/domain/inventory/replenishment-rules';
import { ReplenishmentMath } from '../../src/domain/inventory/replenishment-math';

describe('Prompt 18 — Stock-Monitoring and Replenishment Module', () => {
  let db: Database.Database;
  let replenishmentService: StockReplenishmentService;
  let catalogService: ProductCatalogService;
  let reservationService: StockReservationService;
  let conversionService: UnitConversionService;
  let balanceRepo: StockBalanceRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '11111111-1111-1111-1111-111111111111';
  const locWarehouse = '33333333-3333-3333-3333-333333333333';
  const supplierId = '77777777-7777-7777-7777-777777777777';
  const actor = { userId: 1, role: 'manager', businessId };

  let unitPieceId: string;
  let unitCartonId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    replenishmentService = new StockReplenishmentService(db);
    catalogService = new ProductCatalogService(db);
    reservationService = new StockReservationService(db);
    conversionService = new UnitConversionService(db);
    balanceRepo = new StockBalanceRepository(db);

    // Seed core business, branches, user, locations, supplier
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
        ('2', ?, 'buyer', 'hash', 'Procurement Buyer', 1)
    `).run(businessId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, name, code, location_type, is_sellable, is_active, is_default)
      VALUES (?, ?, ?, 'Main Warehouse', 'WH-MAIN', 'shop_floor', 1, 1, 1)
    `).run(locWarehouse, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, phone, is_active)
      VALUES (?, ?, 'SUP-001', 'Prime Distributors Ltd', '03001122334', 1)
    `).run(supplierId, businessId);

    const piece = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as { id: string };
    unitPieceId = piece.id;

    // Create Carton unit if not present
    let carton = db.prepare("SELECT id FROM units WHERE name = 'Carton'").get() as { id: string } | undefined;
    if (!carton) {
      const cartonUnit = conversionService.createUnit(
        {
          name: 'Carton',
          abbreviation: 'CTN',
          unitType: 'count',
          decimalPrecision: 0,
          businessId
        },
        actor
      );
      unitCartonId = String(cartonUnit.id);
    } else {
      unitCartonId = String(carton.id);
    }
  });

  // Helper to initialize product and on-hand warehouse stock balance
  function createProductWithStock(
    sku: string,
    name: string,
    onHandUnits: number,
    costPrice: number = 10000,
    retailPriceMinor: number = 20000,
    barcode?: string
  ) {
    const prod = catalogService.createProduct({
      businessId,
      sku,
      name,
      barcode: barcode || `890${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      baseUnitId: unitPieceId,
      costPrice,
      retailPriceMinor
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

  it('1. Configures, retrieves, and validates product reorder rules', () => {
    const prod = createProductWithStock('MS-PRO-001', 'Wireless Mouse Pro', 50, 150000, 250000);

    // Validation: target stock < minimum stock must be rejected
    expect(() => {
      replenishmentService.setReorderRule({
        businessId,
        productId: prod.id,
        stockLocationId: locWarehouse,
        minimumStockScaled: 50000, // 50 pcs
        reorderPointScaled: 60000,
        targetStockScaled: 40000 // 40 pcs < 50 pcs min stock -> Error!
      });
    }).toThrow(TargetStockBelowMinimumError);

    // Validation: negative lead time or stock must be rejected
    expect(() => {
      replenishmentService.setReorderRule({
        businessId,
        productId: prod.id,
        minimumStockScaled: -1000,
        targetStockScaled: 50000
      });
    }).toThrow(ReplenishmentRuleValidationError);

    // Save valid rule
    const rule = replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 20000, // 20 pcs
      reorderPointScaled: 40000, // 40 pcs
      targetStockScaled: 100000, // 100 pcs
      leadTimeDays: 7,
      safetyStockScaled: 10000, // 10 pcs
      preferredSupplierId: supplierId
    });

    expect(rule.id).toBeDefined();
    expect(rule.minimumStockScaled).toBe(20000);
    expect(rule.reorderPointScaled).toBe(40000);
    expect(rule.targetStockScaled).toBe(100000);
    expect(rule.leadTimeDays).toBe(7);

    // Retrieve rule
    const fetched = replenishmentService.getReorderRule(prod.id, locWarehouse, businessId);
    expect(fetched).not.toBeNull();
    expect(fetched?.targetStockScaled).toBe(100000);

    // Location fallback: location-agnostic rule is returned when no specific location rule exists
    const agnosticRule = replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      minimumStockScaled: 15000,
      targetStockScaled: 80000
    });
    expect(agnosticRule.stockLocationId).toBeNull();
  });

  it('2. Simple shortfall reorder calculation: Target 100, On Hand 30, Reserved 10 -> Available 20 -> Reorder 80', () => {
    const prod = createProductWithStock('KB-RGB-002', 'Mechanical Keyboard RGB', 30, 500000, 850000);

    // Reserve 10 units for a customer
    reservationService.createReservation({
      businessId,
      branchId,
      sourceType: 'sales_order',
      lines: [
        {
          productId: prod.id,
          stockLocationId: locWarehouse,
          reservedQuantityScaled: 10000, // 10 pieces
          unitId: unitPieceId
        }
      ]
    }, { userId: 1 });

    // Verify stock balance: On Hand = 30, Reserved = 10, Available = 20
    const bal = balanceRepo.getBalance(prod.id, locWarehouse, businessId);
    expect(bal?.onHandScaled).toBe(30000);
    expect(bal?.reservedScaled).toBe(10000);
    const available = bal!.onHandScaled - bal!.reservedScaled;
    expect(available).toBe(20000); // 20 pieces available

    // Set reorder rule: Target = 100 pcs, Min = 25 pcs, ROP = 25 pcs
    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 25000,
      reorderPointScaled: 25000,
      targetStockScaled: 100000,
      preferredSupplierId: supplierId
    });

    // Generate replenishment suggestions
    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    expect(suggestions.length).toBe(1);
    const s = suggestions[0];
    expect(s.productId).toBe(prod.id);
    expect(s.currentAvailableScaled).toBe(20000); // 20 pcs
    expect(s.targetStockScaled).toBe(100000); // 100 pcs
    expect(s.suggestedQuantityScaled).toBe(80000); // exactly 80 pieces shortfall!
    expect(s.status).toBe('open');
    expect(s.calculationReason.rawShortfall).toBe(80);
    expect(s.calculationReason.available).toBe(20);
    expect(s.calculationReason.reserved).toBe(10);
  });

  it('3. Packaging unit rounding: 80 pieces / carton of 24 -> rounds UP to 4 cartons (96 pieces), never rounds down', () => {
    const prod = createProductWithStock('MUG-CRM-003', 'Ceramic Coffee Mug', 20, 10000, 25000);

    // Configure packaging unit: 1 Carton = 24 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: prod.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1,
        isPurchaseUnit: true,
        isDefaultPurchaseUnit: true
      },
      actor
    );

    // Target = 100 pieces, Available = 20 pieces -> Raw Shortfall = 80 pieces
    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 30000,
      reorderPointScaled: 30000,
      targetStockScaled: 100000, // 100 pieces
      preferredSupplierId: supplierId,
      preferredPurchaseUnitId: unitCartonId // Preferred purchase unit: Carton (24 pcs)
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    expect(suggestions.length).toBe(1);
    const s = suggestions[0];
    expect(s.calculationReason.rawShortfall).toBe(80);

    // 80 / 24 = 3.333 -> Rounds UP to 4 cartons = 96 pieces
    expect(s.suggestedQuantityScaled).toBe(96000);
    expect(s.calculationReason.packagesCount).toBe(4);
    expect(s.calculationReason.roundedQuantity).toBe(96);
    expect(s.calculationReason.roundingNote).toContain('rounded up to 4');
  });

  it('4. Dynamic reorder-point rule: Demand 5 pcs/day, lead time 6 days, safety stock 10 pcs -> ROP = 40 pcs', () => {
    const prod = createProductWithStock('TEA-GRN-004', 'Organic Green Tea Box', 35, 30000, 60000);

    // Simulate 30 days of sales totaling 150 pieces (5 pieces/day demand)
    const saleResult = db.prepare(`
      INSERT INTO sales (invoice_number, cashier_id, subtotal, grand_total, payment_method, status, created_at)
      VALUES ('INV-DEMAND-001', 1, 150000, 150000, 'CASH', 'COMPLETED', datetime('now', '-5 days'))
    `).run();
    const saleId = Number(saleResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, product_barcode, unit_name, quantity, conversion_factor, unit_price, line_total)
      VALUES (?, ?, ?, ?, 'Piece', 150, 1, 1000, 150000)
    `).run(saleId, prod.id, prod.name, prod.barcode || '8901234567894');

    // Set rule: Lead time = 6 days, Safety Stock = 10 pcs, Base Target = 100 pcs
    // Dynamic ROP = (5 * 6) + 10 = 40 pcs.
    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 15000,
      reorderPointScaled: 20000, // Manual ROP was 20, but dynamic ROP will evaluate to 40!
      targetStockScaled: 100000,
      leadTimeDays: 6,
      safetyStockScaled: 10000, // 10 pcs
      preferredSupplierId: supplierId
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse,
      historyPeriodDays: 30
    });

    expect(suggestions.length).toBe(1);
    const s = suggestions[0];
    expect(s.calculationReason.method).toBe('DEMAND_LEAD_TIME');
    expect(s.calculationReason.averageDailyDemand).toBe(5);
    expect(s.calculationReason.leadTimeDays).toBe(6);
    expect(s.calculationReason.safetyStock).toBe(10);
    expect(s.calculationReason.reorderPoint).toBe(40); // Dynamic ROP is 40 pcs!
    expect(s.currentAvailableScaled).toBe(35000); // 35 pcs <= 40 pcs triggered the reorder!
    expect(s.suggestedQuantityScaled).toBe(65000); // 100 - 35 = 65 pcs reorder
  });

  it('5. Forecasting rules & uncertainty: Flags new product and zero sales with LOW confidence', () => {
    // 1. Brand new product created recently with 0 sales
    const newProd = createProductWithStock('BLB-SMT-005', 'Novel Smart Bulb', 5, 80000, 150000);

    replenishmentService.setReorderRule({
      businessId,
      productId: newProd.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000, // 10 pcs min
      reorderPointScaled: 10000,
      targetStockScaled: 50000
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    const s = suggestions.find((x) => x.productId === newProd.id);
    expect(s).toBeDefined();
    expect(s?.calculationReason.confidence).toBe('LOW');
    expect(s?.calculationReason.flags).toContain('NEW_PRODUCT_LOW_HISTORY');
    expect(s?.calculationReason.flags).toContain('ZERO_SALES');
  });

  it('6. Inactive/discontinued products are completely ignored during replenishment generation', () => {
    const discontinuedProd = createProductWithStock('GPU-DISC-006', 'Discontinued GPU Model', 0, 500000, 750000);

    // Deactivate the product
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(discontinuedProd.id);

    replenishmentService.setReorderRule({
      businessId,
      productId: discontinuedProd.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      reorderPointScaled: 10000,
      targetStockScaled: 50000
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    const found = suggestions.find((x) => x.productId === discontinuedProd.id);
    expect(found).toBeUndefined(); // Ignored!
  });

  it('7. Draft PO conversion: Creates draft PO in purchase_orders without altering stock', () => {
    const prod = createProductWithStock('CHR-ERGO-007', 'Ergonomic Office Chair', 5, 800000, 1400000);

    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      reorderPointScaled: 10000,
      targetStockScaled: 30000, // 30 pcs target
      preferredSupplierId: supplierId
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    expect(suggestions.length).toBe(1);
    const suggId = suggestions[0].id;

    // Initial stock balance
    const preBal = balanceRepo.getBalance(prod.id, locWarehouse, businessId);
    expect(preBal?.onHandScaled).toBe(5000);

    // Convert suggestions to DRAFT Purchase Order
    const poResult = replenishmentService.convertSuggestionsToDraftPo(
      {
        businessId,
        actorUserId: 1,
        suggestionIds: [suggId],
        supplierId,
        notes: 'Replenishment conversion test'
      },
      { userId: 1 }
    );

    expect(poResult.purchaseOrderId).toBeGreaterThan(0);
    expect(poResult.purchaseOrderNumber).toContain('PO-DRAFT-');
    expect(poResult.convertedSuggestionsCount).toBe(1);

    // Verify PO status is strictly 'DRAFT'
    const poRow = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poResult.purchaseOrderId) as any;
    expect(poRow.status).toBe('DRAFT');
    expect(poRow.supplier_id).toBe(supplierId);

    // Verify suggestion status is updated to 'converted'
    const updatedSugg = replenishmentService.listSuggestions({ businessId, status: 'converted' });
    expect(updatedSugg.some((x) => x.id === suggId)).toBe(true);

    // CRITICAL REQUIREMENT: Stock balance MUST NOT be altered when PO is created as draft!
    const postBal = balanceRepo.getBalance(prod.id, locWarehouse, businessId);
    expect(postBal?.onHandScaled).toBe(5000); // UNCHANGED!
  });

  it('8. Guard against converting suggestions for inactive suppliers', () => {
    const inactiveSupId = '88888888-8888-8888-8888-888888888888';
    db.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, phone, is_active)
      VALUES (?, ?, 'SUP-INACTIVE', 'Defunct Wholesale', '03009999999', 0)
    `).run(inactiveSupId, businessId);

    const prod = createProductWithStock('TST-INACT-008', 'Testing Product Inactive', 2, 10000, 20000);

    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      targetStockScaled: 30000,
      preferredSupplierId: inactiveSupId
    });

    const suggestions = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });
    expect(suggestions.length).toBe(1);

    // Conversion must throw InactiveSupplierReplenishmentError
    expect(() => {
      replenishmentService.convertSuggestionsToDraftPo(
        {
          businessId,
          actorUserId: 1,
          suggestionIds: [suggestions[0].id],
          supplierId: inactiveSupId
        },
        { userId: 1 }
      );
    }).toThrow(InactiveSupplierReplenishmentError);
  });

  it('9. Suggestion editing and dismissal', () => {
    const prod = createProductWithStock('PEN-BOX-009', 'Ballpoint Pen Box', 2, 5000, 10000);

    replenishmentService.setReorderRule({
      businessId,
      productId: prod.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      targetStockScaled: 50000
    });

    const [sugg] = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    expect(sugg.suggestedQuantityScaled).toBe(48000); // 50 - 2 = 48 pcs

    // Edit suggested quantity manually (e.g., manager decides to order 60 pcs instead)
    const edited = replenishmentService.editSuggestionQuantity(sugg.id, 60000);
    expect(edited.suggestedQuantityScaled).toBe(60000);

    // Dismiss suggestion
    replenishmentService.dismissSuggestion(sugg.id);
    const openList = replenishmentService.listSuggestions({ businessId, status: 'open' });
    expect(openList.find((x) => x.id === sugg.id)).toBeUndefined();

    const dismissedList = replenishmentService.listSuggestions({ businessId, status: 'dismissed' });
    expect(dismissedList.find((x) => x.id === sugg.id)).toBeDefined();
  });

  it('10. Real-time stock alerts and duplicate prevention', () => {
    const oosProd = createProductWithStock('SDA-OOS-010', 'Out of Stock Soda', 0, 2000, 5000);
    const lowProd = createProductWithStock('CHP-LOW-011', 'Low Stock Chips', 4, 3000, 6000);

    replenishmentService.setReorderRule({
      businessId,
      productId: oosProd.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      targetStockScaled: 50000
    });

    replenishmentService.setReorderRule({
      businessId,
      productId: lowProd.id,
      stockLocationId: locWarehouse,
      minimumStockScaled: 10000,
      targetStockScaled: 50000
    });

    // Check alerts
    const alerts = replenishmentService.getStockAlerts(businessId, locWarehouse);
    expect(alerts.length).toBe(2);

    const oosAlert = alerts.find((a) => a.productId === oosProd.id);
    expect(oosAlert?.type).toBe('OUT_OF_STOCK');

    const lowAlert = alerts.find((a) => a.productId === lowProd.id);
    expect(lowAlert?.type).toBe('BELOW_MINIMUM');

    // Deduplication check: scanning twice does NOT duplicate open suggestions
    const scan1 = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });
    const scan2 = replenishmentService.generateReplenishmentSuggestions({
      businessId,
      stockLocationId: locWarehouse
    });

    const openCount = replenishmentService.listSuggestions({ businessId, status: 'open' }).length;
    expect(openCount).toBe(2); // Exactly 2, not 4!
  });
});
