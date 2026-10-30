import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { PurchaseOrderService } from '../../src/application/services/PurchaseOrderService';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import {
  CreatePurchaseOrderInput,
  ReceiveGoodsInput,
  RecordPurchaseInvoiceInput
} from '../../src/shared/types/purchase-order';
import {
  InactiveSupplierError,
  OverDeliveryError,
  CannotCancelOrderWithReceiptsError,
  UnauthorizedApprovalError,
  PurchaseOrderNotFoundError
} from '../../src/domain/purchase/purchase-order-rules';
import { PurchaseOrderMath } from '../../src/domain/purchase/purchase-order-math';

describe('Prompt 21 — Purchase-Order Module & Inbound Procurement Workflow', () => {
  let db: Database.Database;
  let poService: PurchaseOrderService;
  let productRepo: ProductRepository;
  let balanceRepo: StockBalanceRepository;
  let supplierRepo: SupplierRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const warehouseLocationId = '00000000-0000-0000-0000-000000000003';
  const shopLocationId = '00000000-0000-0000-0000-000000000004';
  const activeSupplierId = '00000000-0000-0000-0000-000000000005';
  const inactiveSupplierId = '00000000-0000-0000-0000-000000000006';

  const adminActor = { userId: 'user-admin', role: 'admin', businessId };
  const managerActor = { userId: 'user-manager', role: 'manager', businessId };
  const cashierActor = { userId: 'user-cashier', role: 'cashier', businessId };

  let ordinaryProdId: number;
  let batchProdId: number;
  let serialProdId: number;
  let pieceUnitId: string;
  let boxUnitId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    poService = new PurchaseOrderService(db);
    productRepo = new ProductRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    supplierRepo = new SupplierRepository(db);

    // Retrieve real unit IDs
    const pieceUnit = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as any;
    const boxUnit = db.prepare("SELECT id FROM units WHERE name = 'Box'").get() as any;
    pieceUnitId = String(pieceUnit?.id || '1');
    boxUnitId = String(boxUnit?.id || '5');

    // Seed branch & stock locations
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, code, name, is_active)
      VALUES (?, ?, 'BR-MAIN', 'Main Distribution Center', 1)
    `).run(branchId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-WH', 'Central Warehouse', 'warehouse', 1)
    `).run(warehouseLocationId, businessId, branchId);

    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, code, name, location_type, is_default, is_active)
      VALUES (?, ?, ?, 'LOC-SHOP', 'Retail Shop Floor', 'shop_floor', 1, 1)
    `).run(shopLocationId, businessId, branchId);

    // Seed suppliers
    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-ACTIVE', 'Prime Logistics Corp', 1, 50000000, 0)
    `).run(activeSupplierId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-INACTIVE', 'Defunct Wholesale Ltd', 0, 0, 0)
    `).run(inactiveSupplierId, businessId);

    // Seed products
    ordinaryProdId = productRepo.create({
      name: 'Industrial Safety Helmet',
      sku: 'SKU-HELMET-01',
      barcode: 'BAR-HELMET-01',
      categoryId: 1,
      costPrice: 2500, // 25.00
      sellingPrice: 4000, // 40.00
      currentStock: 0
    });

    batchProdId = productRepo.create({
      name: 'Organic Milk 1L',
      sku: 'SKU-MILK-01',
      barcode: 'BAR-MILK-01',
      categoryId: 1,
      costPrice: 120, // 1.20
      sellingPrice: 200,
      currentStock: 0
    });

    serialProdId = productRepo.create({
      name: 'Rugged Handheld Scanner',
      sku: 'SKU-SCAN-01',
      barcode: 'BAR-SCAN-01',
      categoryId: 1,
      costPrice: 15000, // 150.00
      sellingPrice: 25000,
      currentStock: 0
    });

    // Configure batch and serial tracking settings
    db.prepare(`
      INSERT OR REPLACE INTO product_batch_settings (
        id, business_id, product_id, requires_batch, requires_expiry, expiry_warning_days, expiry_sale_policy, batch_cost_policy
      ) VALUES (?, ?, ?, 1, 1, 30, 'block', 'batch_specific')
    `).run('batch-set-01', businessId, String(batchProdId));

    db.prepare(`
      INSERT OR REPLACE INTO product_serial_settings (
        id, business_id, product_id, serial_tracking_required, allow_manual_serial_entry
      ) VALUES (?, ?, ?, 1, 1)
    `).run('serial-set-01', businessId, String(serialProdId));
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // TEST 1: CORE SEPARATION OF CONCERNS (PO CREATION / APPROVAL != STOCK OR PAYABLE)
  // =========================================================================
  it('1. Creating or approving a purchase order must NOT increase inventory or create supplier payables', () => {
    const input: CreatePurchaseOrderInput = {
      businessId,
      branchId,
      supplierId: activeSupplierId,
      currencyCode: 'PKR',
      notes: 'Initial procurement order',
      lines: [
        {
          productId: String(ordinaryProdId),
          purchaseUnitId: pieceUnitId,
          orderedQuantityScaled: 100_000, // 100 units
          unitPriceMinor: 2500, // 25.00
          taxRatePercent: 5
        }
      ]
    };

    const po = poService.createOrder(input, adminActor);
    expect(po.status).toBe('draft');
    expect(po.lines).toHaveLength(1);

    // Check physical inventory balance: MUST BE ZERO
    const initialBalance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(initialBalance ? initialBalance.onHandScaled : 0).toBe(0);

    // Check stock movements table: MUST BE EMPTY
    const movements = db.prepare('SELECT * FROM stock_movements WHERE business_id = ?').all(businessId);
    expect(movements).toHaveLength(0);

    // Check supplier ledger: MUST BE ZERO
    const supplierLedger = db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ?').all(activeSupplierId);
    expect(supplierLedger).toHaveLength(0);

    // Submit order for approval
    const pendingPo = poService.submitForApproval(po.id, adminActor);
    expect(pendingPo.status).toBe('pending_approval');

    // Approve order
    const approvedPo = poService.approveOrder(po.id, managerActor);
    expect(approvedPo.status).toBe('approved');
    expect(approvedPo.approvedBy).toBe('user-manager');

    // Ensure stock and payables are STILL zero
    const afterApprovalBalance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(afterApprovalBalance ? afterApprovalBalance.onHandScaled : 0).toBe(0);
    const afterApprovalLedger = db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ?').all(activeSupplierId);
    expect(afterApprovalLedger).toHaveLength(0);
  });

  // =========================================================================
  // TEST 2: PURCHASE MATHEMATICS ENGINE (EXACT MINOR CURRENCY UNITS)
  // =========================================================================
  it('2. Evaluates exact line calculations, discounts, document charges, and totals without floating point errors', () => {
    // 10 units @ 15.50 each (1550 minor) with 150 minor discount and 16% tax
    // Gross = 10 * 1550 = 15,500 minor units
    // Line discount = 150 minor units
    // Net = 15,350 minor units
    // Tax 16% of 15,350 = round(15350 * 16 / 100) = 2,456 minor units
    // Line total = 15,350 + 2,456 = 17,806 minor units
    const lineMath = PurchaseOrderMath.calculateLine({
      orderedQuantityScaled: 10_000,
      unitPriceMinor: 1550,
      lineDiscountMinor: 150,
      taxRatePercent: 16
    });

    expect(lineMath.grossLineAmountMinor).toBe(15500);
    expect(lineMath.netLineAmountMinor).toBe(15350);
    expect(lineMath.taxAmountMinor).toBe(2456);
    expect(lineMath.lineTotalMinor).toBe(17806);

    // Aggregate with document-level discount and charges
    const orderTotals = PurchaseOrderMath.calculateOrderTotals({
      lines: [
        {
          grossLineAmountMinor: lineMath.grossLineAmountMinor,
          lineDiscountMinor: 150,
          taxAmountMinor: lineMath.taxAmountMinor,
          lineTotalMinor: lineMath.lineTotalMinor
        }
      ],
      documentDiscountMinor: 500, // Rs 5.00
      shippingMinor: 2000, // Rs 20.00 freight
      otherChargesMinor: 500 // Rs 5.00 packaging
    });

    // Subtotal = 15,500
    // Total discount = 150 (line) + 500 (doc) = 650
    // Net before charges = 15,500 - 650 = 14,850
    // Tax = 2,456
    // Shipping = 2,000
    // Other charges = 500
    // Grand total = 14,850 + 2,456 + 2,000 + 500 = 19,806
    expect(orderTotals.subtotalMinor).toBe(15500);
    expect(orderTotals.discountMinor).toBe(650);
    expect(orderTotals.taxMinor).toBe(2456);
    expect(orderTotals.shippingMinor).toBe(2000);
    expect(orderTotals.otherChargesMinor).toBe(500);
    expect(orderTotals.totalMinor).toBe(19806);
  });

  // =========================================================================
  // TEST 3: LAST PURCHASE PRICE LOOKUP
  // =========================================================================
  it('3. Pre-fills last purchase price for supplier and product pair based on approved/completed procurement history', () => {
    // Initially no purchase history exists
    const initialPrice = poService.getLastPurchasePrice(businessId, activeSupplierId, String(ordinaryProdId));
    expect(initialPrice).toBeNull();

    // Create and approve order with price 2750 minor units (27.50)
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 20_000,
            unitPriceMinor: 2750
          }
        ]
      },
      adminActor
    );
    poService.approveOrder(po.id, managerActor);

    // Price is now recorded in purchase orders history
    const recordedPrice = poService.getLastPurchasePrice(businessId, activeSupplierId, String(ordinaryProdId));
    expect(recordedPrice).toBe(2750);
  });

  // =========================================================================
  // TEST 4: MULTI-STEP APPROVAL WORKFLOW & THRESHOLDS
  // =========================================================================
  it('4. Correctly enforces approval threshold policy and role authorizations', () => {
    // Configure threshold: 10,000 minor units (Rs. 100.00)
    poService.configureSettings(businessId, {
      requireApprovalAboveMinor: 10000,
      allowSelfApproval: true
    });

    // Case A: Order total 5,000 minor units (<= threshold) with submitForApproval -> Auto-approves
    const smallOrder = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        submitForApproval: true,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 2_000, // 2 units
            unitPriceMinor: 2500 // 2 * 2500 = 5000 <= 10000
          }
        ]
      },
      cashierActor
    );
    expect(smallOrder.status).toBe('approved');

    // Case B: Order total 50,000 minor units (> threshold) with submitForApproval -> Transitions to pending_approval
    const bigOrder = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        submitForApproval: true,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 20_000, // 20 units
            unitPriceMinor: 2500 // 20 * 2500 = 50000 > 10000
          }
        ]
      },
      cashierActor
    );
    expect(bigOrder.status).toBe('pending_approval');

    // Case C: Non-manager / non-admin cannot approve
    expect(() => {
      poService.approveOrder(bigOrder.id, cashierActor);
    }).toThrow(UnauthorizedApprovalError);

    // Case D: Authorized manager approves
    const approvedBig = poService.approveOrder(bigOrder.id, managerActor);
    expect(approvedBig.status).toBe('approved');
    expect(approvedBig.approvedBy).toBe('user-manager');
    expect(approvedBig.approvedAt).not.toBeNull();
  });

  // =========================================================================
  // TEST 5: PARTIAL GOODS RECEIPT & OUTSTANDING TRACKING
  // =========================================================================
  it('5. Inbound partial receiving increases location stock, logs traceable movements, and tracks remaining balances', () => {
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 50_000, // 50 items
            unitPriceMinor: 2500
          }
        ]
      },
      adminActor
    );
    poService.approveOrder(po.id, managerActor);

    const poLine = po.lines![0];

    // Receive partial shipment: 20 items
    const receiveInput: ReceiveGoodsInput = {
      purchaseOrderId: po.id,
      receiptNumber: 'GRN-001',
      stockLocationId: warehouseLocationId,
      receiptDate: new Date().toISOString(),
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          receivedQuantityScaled: 20_000
        }
      ]
    };

    const { purchaseOrder: updatedPo } = poService.receiveGoods(receiveInput, adminActor);
    expect(updatedPo.status).toBe('partially_received');

    const updatedLine = updatedPo.lines![0];
    expect(updatedLine.receivedQuantityScaled).toBe(20_000);

    // Physical stock balance at warehouse must now be 20_000
    const warehouseBalance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(warehouseBalance?.onHandScaled).toBe(20_000);

    // Product currentStock should also be 20
    const prod = productRepo.findById(ordinaryProdId);
    expect(prod?.currentStock).toBe(20);

    // Outstanding delivery report
    const outstanding = poService.getOutstandingDeliveryReport(businessId);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0].orderedQuantityScaled).toBe(50_000);
    expect(outstanding[0].receivedQuantityScaled).toBe(20_000);
    expect(outstanding[0].outstandingQuantityScaled).toBe(30_000);
    expect(outstanding[0].outstandingValueMinor).toBe(30 * 2500); // 75,000 minor units
  });

  // =========================================================================
  // TEST 6: FULL GOODS RECEIPT COMPLETION
  // =========================================================================
  it('6. Full goods receipt marks PO as fully_received and closes outstanding delivery obligation', () => {
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 30_000,
            unitPriceMinor: 2500
          }
        ]
      },
      adminActor
    );
    poService.approveOrder(po.id, managerActor);

    // First shipment of 15
    poService.receiveGoods(
      {
        purchaseOrderId: po.id,
        receiptNumber: 'GRN-PART-1',
        stockLocationId: warehouseLocationId,
        lines: [{ purchaseOrderLineId: po.lines![0].id, receivedQuantityScaled: 15_000 }]
      },
      adminActor
    );

    // Final shipment of remaining 15
    const { purchaseOrder: completedPo } = poService.receiveGoods(
      {
        purchaseOrderId: po.id,
        receiptNumber: 'GRN-PART-2',
        stockLocationId: warehouseLocationId,
        lines: [{ purchaseOrderLineId: po.lines![0].id, receivedQuantityScaled: 15_000 }]
      },
      adminActor
    );

    expect(completedPo.status).toBe('fully_received');
    expect(completedPo.lines![0].receivedQuantityScaled).toBe(30_000);

    const warehouseBalance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(warehouseBalance?.onHandScaled).toBe(30_000);

    // Outstanding delivery report should now be empty for this completed order
    const outstanding = poService.getOutstandingDeliveryReport(businessId);
    expect(outstanding).toHaveLength(0);
  });

  // =========================================================================
  // TEST 7: OVER-DELIVERY POLICIES (REJECT, TOLERANCE, MANAGER OVERRIDE)
  // =========================================================================
  it('7. Enforces over-delivery policy: rejects excess by default, allows tolerance, and honors manager override', () => {
    // 7A: Default policy is 'reject'
    const po1 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 2500 }]
      },
      adminActor
    );
    poService.approveOrder(po1.id, managerActor);

    // Attempting to receive 12 items (12,000) when 10 were ordered
    expect(() => {
      poService.receiveGoods(
        {
          purchaseOrderId: po1.id,
          receiptNumber: 'GRN-OVER-01',
          stockLocationId: warehouseLocationId,
          lines: [{ purchaseOrderLineId: po1.lines![0].id, receivedQuantityScaled: 12_000 }]
        },
        adminActor
      );
    }).toThrow(OverDeliveryError);

    // 7B: Manager override allows excess even when policy is 'reject'
    const { purchaseOrder: overriddenPo } = poService.receiveGoods(
      {
        purchaseOrderId: po1.id,
        receiptNumber: 'GRN-OVER-02',
        stockLocationId: warehouseLocationId,
        managerApproved: true,
        managerOverrideReason: 'Supplier offered free promotional surplus',
        lines: [{ purchaseOrderLineId: po1.lines![0].id, receivedQuantityScaled: 12_000 }]
      },
      managerActor
    );
    expect(overriddenPo.lines![0].receivedQuantityScaled).toBe(12_000);

    // 7C: Tolerance policy (e.g. 10% allowed)
    poService.configureSettings(businessId, {
      overDeliveryPolicy: 'allow_tolerance',
      overDeliveryTolerancePercent: 10
    });

    const po2 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 20_000, unitPriceMinor: 2500 }]
      },
      adminActor
    );
    poService.approveOrder(po2.id, managerActor);

    // 20 items + 10% = max 22 items allowed
    // Receiving 21 items (within 10%) succeeds
    const { purchaseOrder: toleranceSuccess } = poService.receiveGoods(
      {
        purchaseOrderId: po2.id,
        receiptNumber: 'GRN-TOL-01',
        stockLocationId: warehouseLocationId,
        lines: [{ purchaseOrderLineId: po2.lines![0].id, receivedQuantityScaled: 21_000 }]
      },
      adminActor
    );
    expect(toleranceSuccess.lines![0].receivedQuantityScaled).toBe(21_000);

    // Receiving more than 22 items (e.g. 25) fails tolerance check
    const po3 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 20_000, unitPriceMinor: 2500 }]
      },
      adminActor
    );
    poService.approveOrder(po3.id, managerActor);

    expect(() => {
      poService.receiveGoods(
        {
          purchaseOrderId: po3.id,
          receiptNumber: 'GRN-TOL-02',
          stockLocationId: warehouseLocationId,
          lines: [{ purchaseOrderLineId: po3.lines![0].id, receivedQuantityScaled: 25_000 }]
        },
        adminActor
      );
    }).toThrow(OverDeliveryError);
  });

  // =========================================================================
  // TEST 8: SUPPLIER INVOICING WITHOUT DOUBLE-RECEIVING STOCK
  // =========================================================================
  it('8. Recording a supplier invoice logs a payable in the supplier ledger without duplicating physical stock', () => {
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 3000 }]
      },
      adminActor
    );
    poService.approveOrder(po.id, managerActor);

    // Goods are received first
    poService.receiveGoods(
      {
        purchaseOrderId: po.id,
        receiptNumber: 'GRN-INV-01',
        stockLocationId: warehouseLocationId,
        lines: [{ purchaseOrderLineId: po.lines![0].id, receivedQuantityScaled: 10_000 }]
      },
      adminActor
    );

    const stockAfterReceive = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled;
    expect(stockAfterReceive).toBe(10_000);

    // Now supplier issues bill/invoice
    const invoiceInput: RecordPurchaseInvoiceInput = {
      purchaseOrderId: po.id,
      invoiceNumber: 'INV-SUPP-9921',
      invoiceDate: '2026-10-30',
      lines: [
        {
          purchaseOrderLineId: po.lines![0].id,
          invoicedQuantityScaled: 10_000,
          invoicedUnitPriceMinor: 3000
        }
      ]
    };

    const { purchaseOrder: invoicedPo } = poService.recordPurchaseInvoice(invoiceInput, adminActor);
    expect(invoicedPo.lines![0].invoicedQuantityScaled).toBe(10_000);

    // Verify supplier ledger contains the payable entry
    const ledgerEntries = db.prepare(`
      SELECT * FROM supplier_ledger 
      WHERE supplier_id = ?
    `).all(activeSupplierId) as any[];

    expect(ledgerEntries.length).toBeGreaterThan(0);

    // Verify physical stock balance HAS NOT CHANGED (remains 10_000, NOT 20_000)
    const stockAfterInvoice = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled;
    expect(stockAfterInvoice).toBe(10_000);
  });

  // =========================================================================
  // TEST 9: CANCELLATION & CLOSURE RULES
  // =========================================================================
  it('9. Allows cancelling unfulfilled orders but strictly blocks cancellation after goods are received', () => {
    // 9A: Cancel approved order with zero receipts -> Allowed
    const po1 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 2500 }]
      },
      adminActor
    );
    poService.approveOrder(po1.id, managerActor);

    const cancelledPo = poService.cancelOrder(po1.id, 'Supplier out of inventory', adminActor);
    expect(cancelledPo.status).toBe('cancelled');

    // 9B: Attempt to cancel order with partial receipts -> Strictly blocked
    const po2 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 20_000, unitPriceMinor: 2500 }]
      },
      adminActor
    );
    poService.approveOrder(po2.id, managerActor);
    poService.receiveGoods(
      {
        purchaseOrderId: po2.id,
        receiptNumber: 'GRN-CANC-01',
        stockLocationId: warehouseLocationId,
        lines: [{ purchaseOrderLineId: po2.lines![0].id, receivedQuantityScaled: 5_000 }]
      },
      adminActor
    );

    expect(() => {
      poService.cancelOrder(po2.id, 'Try to cancel', adminActor);
    }).toThrow(CannotCancelOrderWithReceiptsError);

    // 9C: Closing an order (e.g. short delivery accepted)
    const closedPo = poService.closeOrder(po2.id, 'Supplier cannot fulfill remaining 15 units', adminActor);
    expect(closedPo.status).toBe('closed');
  });

  // =========================================================================
  // TEST 10: UNIT CONVERSION HISTORICAL SNAPSHOT PRESERVATION
  // =========================================================================
  it('10. Freezes unit conversion numerator and denominator at line creation time', () => {
    // Order 5 Boxes (where 1 Box = 12 Pieces in initial packaging)
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: boxUnitId,
            orderedQuantityScaled: 5_000, // 5 boxes
            unitPriceMinor: 24000, // 240.00 per box
            conversionNumerator: 12,
            conversionDenominator: 1
          }
        ]
      },
      adminActor
    );

    const line = po.lines![0];
    expect(line.conversionNumerator).toBe(12);
    expect(line.conversionDenominator).toBe(1);
    expect(line.baseQuantityScaled).toBe(60_000); // 5 * 12 = 60 base pieces

    // If unit configuration in catalog is altered later, the historical order retains 12:1
    const fetched = poService.findById(po.id);
    expect(fetched?.lines![0].conversionNumerator).toBe(12);
    expect(fetched?.lines![0].baseQuantityScaled).toBe(60_000);
  });

  // =========================================================================
  // TEST 11: GUARDS AGAINST INACTIVE SUPPLIERS
  // =========================================================================
  it('11. Strictly prevents creating purchase orders for inactive suppliers', () => {
    expect(() => {
      poService.createOrder(
        {
          businessId,
          branchId,
          supplierId: inactiveSupplierId,
          lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 2500 }]
        },
        adminActor
      );
    }).toThrow(InactiveSupplierError);
  });

  // =========================================================================
  // TEST 12: IDEMPOTENT ORDER CREATION
  // =========================================================================
  it('12. Prevents double-creation when the same idempotency key is submitted twice', () => {
    const idempotencyKey = 'po-idemp-unique-key-999';
    const input: CreatePurchaseOrderInput = {
      businessId,
      branchId,
      supplierId: activeSupplierId,
      idempotencyKey,
      lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 2500 }]
    };

    const firstPo = poService.createOrder(input, adminActor);
    const secondPo = poService.createOrder(input, adminActor);

    expect(secondPo.id).toBe(firstPo.id);
    expect(secondPo.purchaseOrderNumber).toBe(firstPo.purchaseOrderNumber);

    // Verify only 1 order exists in database
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM purchase_orders WHERE business_id = ?').get(businessId) as any;
    expect(totalOrders.count).toBe(1);
  });

  // =========================================================================
  // TEST 13: BATCH & SERIAL INTEGRATION ON GOODS RECEIPT
  // =========================================================================
  it('13. Seamlessly tracks batch and serial metadata during inbound goods receipt', () => {
    // 13A: Inbound batch receiving
    const batchPo = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(batchProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 50_000, unitPriceMinor: 120 }]
      },
      adminActor
    );
    poService.approveOrder(batchPo.id, managerActor);

    poService.receiveGoods(
      {
        purchaseOrderId: batchPo.id,
        receiptNumber: 'GRN-BATCH-01',
        stockLocationId: warehouseLocationId,
        lines: [
          {
            purchaseOrderLineId: batchPo.lines![0].id,
            receivedQuantityScaled: 50_000,
            batchNumber: 'BATCH-MILK-2026A',
            expiryDate: '2026-12-31'
          }
        ]
      },
      adminActor
    );

    const batch = db.prepare(`
      SELECT * FROM product_batches 
      WHERE business_id = ? AND batch_number = 'BATCH-MILK-2026A'
    `).get(businessId) as any;
    expect(batch).toBeDefined();
    expect(batch.expiry_date).toBe('2026-12-31');

    // 13B: Inbound serial number receiving
    const serialPo = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(serialProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 2_000, unitPriceMinor: 15000 }]
      },
      adminActor
    );
    poService.approveOrder(serialPo.id, managerActor);

    poService.receiveGoods(
      {
        purchaseOrderId: serialPo.id,
        receiptNumber: 'GRN-SERIAL-01',
        stockLocationId: warehouseLocationId,
        lines: [
          {
            purchaseOrderLineId: serialPo.lines![0].id,
            receivedQuantityScaled: 2_000,
            serialNumbers: ['SCAN-SN-001', 'SCAN-SN-002']
          }
        ]
      },
      adminActor
    );

    const serials = db.prepare(`
      SELECT * FROM product_serial_numbers 
      WHERE business_id = ? AND serial_number IN ('SCAN-SN-001', 'SCAN-SN-002')
    `).all(businessId) as any[];
    expect(serials).toHaveLength(2);
    expect(serials[0].status).toBe('in_stock');
  });
});
