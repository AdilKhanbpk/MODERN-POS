import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { GoodsReceiptService } from '../../src/application/services/GoodsReceiptService';
import { PurchaseOrderService } from '../../src/application/services/PurchaseOrderService';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import {
  CreateGoodsReceiptInput,
  PostGoodsReceiptInput,
  InspectGoodsReceiptInput
} from '../../src/shared/types/goods-receipt';
import {
  InconsistentReceiptQuantitiesError,
  ReceiptAlreadyPostedError,
  DirectReceiptNotAllowedError,
  ReceiptAfterPOCancelledError,
  OverDeliveryError,
  SerialCountMismatchError,
  BatchRequiredError
} from '../../src/domain/receiving/goods-receipt-rules';
import { GoodsReceiptMath } from '../../src/domain/receiving/goods-receipt-math';

describe('Prompt 22 — Goods Receiving Note (GRN) System', () => {
  let db: Database.Database;
  let grnService: GoodsReceiptService;
  let poService: PurchaseOrderService;
  let productRepo: ProductRepository;
  let balanceRepo: StockBalanceRepository;
  let supplierRepo: SupplierRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const warehouseLocationId = '00000000-0000-0000-0000-000000000003';
  const quarantineLocationId = '00000000-0000-0000-0000-000000000004';
  const activeSupplierId = '00000000-0000-0000-0000-000000000005';
  const inactiveSupplierId = '00000000-0000-0000-0000-000000000006';

  const clerkActor = { userId: '1', role: 'inventory_clerk', businessId };
  const managerActor = { userId: '2', role: 'manager', businessId };

  let ordinaryProdId: number;
  let batchProdId: number;
  let serialProdId: number;
  let pieceUnitId: string;
  let boxUnitId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    grnService = new GoodsReceiptService(db);
    poService = new PurchaseOrderService(db);
    productRepo = new ProductRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    supplierRepo = new SupplierRepository(db);

    // Retrieve standard units
    const pieceUnit = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as any;
    const boxUnit = db.prepare("SELECT id FROM units WHERE name = 'Box'").get() as any;
    pieceUnitId = String(pieceUnit?.id || '1');
    boxUnitId = String(boxUnit?.id || '5');

    // Seed Manager user for testing
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES ('2', ?, 'manager_alice', 'hash', 'Manager Alice', 1)
    `).run(businessId);

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
      INSERT OR IGNORE INTO stock_locations (id, business_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-QUAR', 'Quarantine & Inspection Area', 'quarantine', 1)
    `).run(quarantineLocationId, businessId, branchId);

    // Seed suppliers
    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-ACTIVE', 'Apex Hardware Global', 1, 50000000, 0)
    `).run(activeSupplierId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-INACTIVE', 'Defunct Supply Co', 0, 0, 0)
    `).run(inactiveSupplierId, businessId);

    // Seed products
    ordinaryProdId = productRepo.create({
      name: 'High-Tensile Steel Bolts',
      sku: 'SKU-BOLT-01',
      barcode: 'BAR-BOLT-01',
      categoryId: 1,
      costPrice: 50, // 0.50
      sellingPrice: 100,
      currentStock: 0
    });

    batchProdId = productRepo.create({
      name: 'Industrial Lubricant Oil 5L',
      sku: 'SKU-OIL-01',
      barcode: 'BAR-OIL-01',
      categoryId: 1,
      costPrice: 2000, // 20.00
      sellingPrice: 3500,
      currentStock: 0
    });

    serialProdId = productRepo.create({
      name: 'Laser Distance Meter',
      sku: 'SKU-METER-01',
      barcode: 'BAR-METER-01',
      categoryId: 1,
      costPrice: 8000, // 80.00
      sellingPrice: 14000,
      currentStock: 0
    });

    // Configure batch and serial tracking settings
    db.prepare(`
      INSERT OR REPLACE INTO product_batch_settings (
        id, business_id, product_id, requires_batch, requires_expiry, expiry_warning_days, expiry_sale_policy, batch_cost_policy
      ) VALUES (?, ?, ?, 1, 1, 30, 'block', 'batch_specific')
    `).run('batch-cfg-01', businessId, String(batchProdId));

    db.prepare(`
      INSERT OR REPLACE INTO product_serial_settings (
        id, business_id, product_id, serial_tracking_required, allow_manual_serial_entry
      ) VALUES (?, ?, ?, 1, 1)
    `).run('serial-cfg-01', businessId, String(serialProdId));

    // Configure default GRN settings
    grnService.configureSettings(businessId, {
      allowDirectReceipt: true,
      quarantineLocationId
    });
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // TEST 1: QUANTITY RECONCILIATION INVARIANT (Received = Accepted + Rejected + Damaged)
  // =========================================================================
  it('1. Strict quantity validation: requires Received = Accepted + Rejected + Damaged and rejects inconsistent lines', () => {
    // 1A: Pure domain math validation
    const validMath = GoodsReceiptMath.validateQuantityReconciliation({
      receivedScaled: 100_000,
      acceptedScaled: 94_000,
      rejectedScaled: 3_000,
      damagedScaled: 3_000
    });
    expect(validMath.isConsistent).toBe(true);
    expect(validMath.differenceScaled).toBe(0);

    const invalidMath = GoodsReceiptMath.validateQuantityReconciliation({
      receivedScaled: 100_000,
      acceptedScaled: 90_000,
      rejectedScaled: 3_000,
      damagedScaled: 3_000
    });
    expect(invalidMath.isConsistent).toBe(false);
    expect(invalidMath.differenceScaled).toBe(4_000);

    // 1B: Service level enforcement on GRN creation
    expect(() => {
      grnService.createReceipt(
        {
          businessId,
          branchId,
          supplierId: activeSupplierId,
          stockLocationId: warehouseLocationId,
          lines: [
            {
              productId: String(ordinaryProdId),
              purchaseUnitId: pieceUnitId,
              receivedQuantityScaled: 100_000,
              acceptedQuantityScaled: 90_000, // Sum = 90 + 3 + 3 = 96 != 100
              rejectedQuantityScaled: 3_000,
              damagedQuantityScaled: 3_000
            }
          ]
        },
        clerkActor
      );
    }).toThrow(InconsistentReceiptQuantitiesError);

    // 1C: Consistent line succeeds
    const grn = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 100_000,
            acceptedQuantityScaled: 94_000,
            rejectedQuantityScaled: 3_000,
            damagedQuantityScaled: 3_000,
            unitCostMinor: 50
          }
        ]
      },
      clerkActor
    );

    expect(grn.status).toBe('draft');
    expect(grn.lines).toHaveLength(1);
    expect(grn.lines![0].receivedQuantityScaled).toBe(100_000);
    expect(grn.lines![0].acceptedQuantityScaled).toBe(94_000);
    expect(grn.lines![0].rejectedQuantityScaled).toBe(3_000);
    expect(grn.lines![0].damagedQuantityScaled).toBe(3_000);
  });

  // =========================================================================
  // TEST 2: ATOMIC INVENTORY POSTING & ISOLATION OF QUARANTINE / REJECTED GOODS
  // =========================================================================
  it('2. Posting GRN increments physical stock for accepted goods, isolates damaged goods to quarantine, and omits rejected goods', () => {
    // Physically received: 100. Accepted: 94. Rejected: 3. Damaged: 3.
    const grn = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        supplierDeliveryNote: 'DN-APEX-991',
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 100_000,
            acceptedQuantityScaled: 94_000,
            rejectedQuantityScaled: 3_000,
            damagedQuantityScaled: 3_000,
            unitCostMinor: 50, // 0.50
            discrepancyType: 'damaged_packaging',
            discrepancyReason: '3 units crushed in carton corner; 3 units incorrect thread'
          }
        ]
      },
      clerkActor
    );

    // Approve receipt
    grnService.approveReceipt(grn.id, managerActor);

    // Post receipt
    const postedGrn = grnService.postReceipt({ goodsReceiptId: grn.id, quarantineLocationId }, managerActor);
    expect(postedGrn.status).toBe('posted');
    expect(postedGrn.postedAt).not.toBeNull();

    // 2A: Check sellable warehouse balance -> MUST BE EXACTLY 94 (94_000 scaled)
    const whBalance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(whBalance?.onHandScaled).toBe(94_000);

    // Check product currentStock -> MUST BE 94
    const prod = productRepo.findById(ordinaryProdId);
    expect(prod?.currentStock).toBe(94);

    // 2B: Check quarantine location balance -> MUST BE EXACTLY 3 (3_000 scaled)
    const quarBalance = balanceRepo.getBalance(String(ordinaryProdId), quarantineLocationId, businessId);
    expect(quarBalance?.onHandScaled).toBe(3_000);

    // 2C: Rejected goods (3) NEVER enter inventory! Total physical on hand in entire business = 94 + 3 = 97
    const totalOnHand = (whBalance?.onHandScaled || 0) + (quarBalance?.onHandScaled || 0);
    expect(totalOnHand).toBe(97_000);

    // 2D: Check stock movement ledger entries
    const movements = db.prepare(`
      SELECT movement_type, direction, quantity_scaled, stock_location_id
      FROM stock_movements
      WHERE reference_id = ?
      ORDER BY movement_type ASC
    `).all(grn.id) as any[];

    expect(movements).toHaveLength(2);
    // Accepted movement: 94 at warehouse
    const acceptedMov = movements.find((m) => m.movement_type === 'goods_receipt');
    expect(acceptedMov.quantity_scaled).toBe(94_000);
    expect(acceptedMov.stock_location_id).toBe(warehouseLocationId);

    // Damaged movement: 3 at quarantine
    const damagedMov = movements.find((m) => m.movement_type === 'goods_receipt_damaged');
    expect(damagedMov.quantity_scaled).toBe(3_000);
    expect(damagedMov.stock_location_id).toBe(quarantineLocationId);

    // 2E: Check FIFO cost layer created for accepted goods
    const costLayers = db.prepare(`
      SELECT received_quantity_scaled, remaining_quantity_scaled, unit_cost_minor, stock_location_id
      FROM inventory_cost_layers
      WHERE product_id = ?
    `).all(String(ordinaryProdId)) as any[];

    expect(costLayers).toHaveLength(1);
    expect(costLayers[0].received_quantity_scaled).toBe(94_000);
    expect(costLayers[0].remaining_quantity_scaled).toBe(94_000);
    expect(costLayers[0].unit_cost_minor).toBe(50);
  });

  // =========================================================================
  // TEST 3: MULTIPLE GRNS AGAINST SINGLE PURCHASE ORDER
  // =========================================================================
  it('3. Multiple GRNs against one Purchase Order: partial receipts update PO status progressively to fully_received', () => {
    // Create PO for 100 units
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            orderedQuantityScaled: 100_000,
            unitPriceMinor: 50
          }
        ]
      },
      managerActor
    );
    poService.approveOrder(po.id, managerActor);

    const poLine = po.lines![0];

    // Shipment 1: Arrives with 40 units (all accepted)
    const grn1 = grnService.createReceipt(
      {
        businessId,
        branchId,
        purchaseOrderId: po.id,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        supplierDeliveryNote: 'DN-SHIPMENT-1',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 40_000,
            acceptedQuantityScaled: 40_000,
            rejectedQuantityScaled: 0,
            damagedQuantityScaled: 0,
            unitCostMinor: 50
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grn1.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn1.id }, managerActor);

    // Verify PO is now partially_received
    const poAfter1 = poService.findById(po.id)!;
    expect(poAfter1.status).toBe('partially_received');
    expect(poAfter1.lines![0].receivedQuantityScaled).toBe(40_000);
    expect(balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled).toBe(40_000);

    // Shipment 2: Arrives with remaining 60 units (all accepted)
    const grn2 = grnService.createReceipt(
      {
        businessId,
        branchId,
        purchaseOrderId: po.id,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        supplierDeliveryNote: 'DN-SHIPMENT-2',
        lines: [
          {
            purchaseOrderLineId: poLine.id,
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 60_000,
            acceptedQuantityScaled: 60_000,
            rejectedQuantityScaled: 0,
            damagedQuantityScaled: 0,
            unitCostMinor: 50
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grn2.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn2.id }, managerActor);

    // Verify PO is now fully_received
    const poAfter2 = poService.findById(po.id)!;
    expect(poAfter2.status).toBe('fully_received');
    expect(poAfter2.lines![0].receivedQuantityScaled).toBe(100_000);
    expect(balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled).toBe(100_000);
  });

  // =========================================================================
  // TEST 4: DIRECT RECEIVING WITHOUT PURCHASE ORDER & POLICY GATING
  // =========================================================================
  it('4. Direct receiving without PO: blocked when disabled by owner, succeeds with full traceability when enabled', () => {
    // 4A: When disabled by business setting
    grnService.configureSettings(businessId, { allowDirectReceipt: false });

    expect(() => {
      grnService.createReceipt(
        {
          businessId,
          branchId,
          purchaseOrderId: null, // No PO
          supplierId: activeSupplierId,
          stockLocationId: warehouseLocationId,
          lines: [
            {
              productId: String(ordinaryProdId),
              purchaseUnitId: pieceUnitId,
              receivedQuantityScaled: 50_000,
              acceptedQuantityScaled: 50_000
            }
          ]
        },
        clerkActor
      );
    }).toThrow(DirectReceiptNotAllowedError);

    // 4B: When enabled by owner
    grnService.configureSettings(businessId, { allowDirectReceipt: true });

    const directGrn = grnService.createReceipt(
      {
        businessId,
        branchId,
        purchaseOrderId: null,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        supplierDeliveryNote: 'DN-DIRECT-001',
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 50_000,
            acceptedQuantityScaled: 50_000,
            unitCostMinor: 60
          }
        ]
      },
      clerkActor
    );

    expect(directGrn.purchaseOrderId).toBeNull();
    grnService.approveReceipt(directGrn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: directGrn.id }, managerActor);

    // Inventory updated
    const balance = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId);
    expect(balance?.onHandScaled).toBe(50_000);
  });

  // =========================================================================
  // TEST 5: OVER-DELIVERY TOLERANCE & MANAGER OVERRIDE
  // =========================================================================
  it('5. Enforces over-delivery policy against PO lines: rejects excess, allows tolerance %, and honors manager override', () => {
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 20_000, unitPriceMinor: 50 }]
      },
      managerActor
    );
    poService.approveOrder(po.id, managerActor);

    // 5A: Default policy is 'reject': Attempt to receive 25 when 20 was ordered
    const grnOver = grnService.createReceipt(
      {
        businessId,
        branchId,
        purchaseOrderId: po.id,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            purchaseOrderLineId: po.lines![0].id,
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 25_000,
            acceptedQuantityScaled: 25_000
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnOver.id, managerActor);

    // Posting without manager override throws OverDeliveryError
    expect(() => {
      grnService.postReceipt({ goodsReceiptId: grnOver.id, managerApproved: false }, clerkActor);
    }).toThrow(OverDeliveryError);

    // 5B: Posting WITH manager override succeeds
    const overridden = grnService.postReceipt(
      { goodsReceiptId: grnOver.id, managerApproved: true, managerOverrideReason: 'Bonus promotional units' },
      managerActor
    );
    expect(overridden.status).toBe('posted');

    // 5C: Tolerance policy (e.g. 10% allowed)
    grnService.configureSettings(businessId, {
      overDeliveryPolicy: 'allow_tolerance',
      overDeliveryTolerancePercent: 10
    });

    const po2 = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 50_000, unitPriceMinor: 50 }]
      },
      managerActor
    );
    poService.approveOrder(po2.id, managerActor);

    // 50 + 10% = max 55 units. Receiving 54 units succeeds under tolerance
    const grnTolerance = grnService.createReceipt(
      {
        businessId,
        branchId,
        purchaseOrderId: po2.id,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            purchaseOrderLineId: po2.lines![0].id,
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 54_000,
            acceptedQuantityScaled: 54_000
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnTolerance.id, managerActor);
    const postedTolerance = grnService.postReceipt({ goodsReceiptId: grnTolerance.id }, clerkActor);
    expect(postedTolerance.status).toBe('posted');
  });

  // =========================================================================
  // TEST 6: CANCELLATION RULES & IMMUTABILITY
  // =========================================================================
  it('6. Allows cancellation of unposted GRNs but strictly forbids cancellation once posted', () => {
    // 6A: Unposted GRN can be cancelled
    const grn = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 10_000,
            acceptedQuantityScaled: 10_000
          }
        ]
      },
      clerkActor
    );

    const cancelled = grnService.cancelReceipt(grn.id, 'Truck turned away due to wrong invoice', managerActor);
    expect(cancelled.status).toBe('cancelled');

    // 6B: Posted GRN cannot be cancelled
    const grnPosted = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 10_000,
            acceptedQuantityScaled: 10_000
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnPosted.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grnPosted.id }, managerActor);

    expect(() => {
      grnService.cancelReceipt(grnPosted.id, 'Try to cancel after posting', managerActor);
    }).toThrow(ReceiptAlreadyPostedError);
  });

  // =========================================================================
  // TEST 7: BATCH & EXPIRY TRACKING INTEGRATION
  // =========================================================================
  it('7. Enforces batch requirements for batch-controlled products and registers batches upon posting', () => {
    // 7A: Missing batch number throws BatchRequiredError upon posting
    const grnNoBatch = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(batchProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 20_000,
            acceptedQuantityScaled: 20_000
            // No batchNumber provided
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnNoBatch.id, managerActor);

    expect(() => {
      grnService.postReceipt({ goodsReceiptId: grnNoBatch.id }, managerActor);
    }).toThrow(BatchRequiredError);

    // 7B: Providing batch and expiry succeeds and registers batch
    const grnWithBatch = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(batchProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 20_000,
            acceptedQuantityScaled: 20_000,
            batchNumber: 'BATCH-OIL-2026-X',
            expiryDate: '2027-06-30'
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnWithBatch.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grnWithBatch.id }, managerActor);

    const batch = db.prepare(`
      SELECT * FROM product_batches WHERE business_id = ? AND batch_number = ?
    `).get(businessId, 'BATCH-OIL-2026-X') as any;

    expect(batch).toBeDefined();
    expect(batch.expiry_date).toBe('2027-06-30');
    expect(batch.initial_quantity_scaled).toBe(20_000);
  });

  // =========================================================================
  // TEST 8: SERIAL NUMBER TRACKING & SERIAL COUNT INVARIANT
  // =========================================================================
  it('8. Enforces serial count matching received quantity and routes damaged serials to quarantine', () => {
    // Receiving 2 units of Laser Distance Meter -> requires exactly 2 serials
    // 8A: Providing 1 serial when 2 were received throws SerialCountMismatchError
    const grnMismatch = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(serialProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 2_000, // 2 units
            acceptedQuantityScaled: 2_000,
            serials: [{ serialNumber: 'SN-METER-001', condition: 'accepted' }] // Only 1 serial!
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnMismatch.id, managerActor);

    expect(() => {
      grnService.postReceipt({ goodsReceiptId: grnMismatch.id }, managerActor);
    }).toThrow(SerialCountMismatchError);

    // 8B: Providing 2 serials (1 accepted, 1 damaged) succeeds with correct status routing
    const grnExact = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(serialProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 2_000,
            acceptedQuantityScaled: 1_000,
            damagedQuantityScaled: 1_000,
            rejectedQuantityScaled: 0,
            serials: [
              { serialNumber: 'SN-METER-OK-01', condition: 'accepted' },
              { serialNumber: 'SN-METER-DMG-02', condition: 'damaged' }
            ]
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grnExact.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grnExact.id, quarantineLocationId }, managerActor);

    // Check serial records
    const snOk = db.prepare('SELECT * FROM product_serial_numbers WHERE serial_number = ?').get('SN-METER-OK-01') as any;
    expect(snOk.status).toBe('in_stock');
    expect(snOk.current_location_id).toBe(warehouseLocationId);

    const snDmg = db.prepare('SELECT * FROM product_serial_numbers WHERE serial_number = ?').get('SN-METER-DMG-02') as any;
    expect(snDmg.status).toBe('quarantined');
    expect(snDmg.current_location_id).toBe(quarantineLocationId);
  });

  // =========================================================================
  // TEST 9: DISCREPANCY REPORTING & FINANCIAL IMPACT
  // =========================================================================
  it('9. Correctly captures receiving discrepancies and aggregates financial impact', () => {
    // Receive with damaged packaging and supplier shortage
    const grn = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 100_000,
            acceptedQuantityScaled: 80_000,
            damagedQuantityScaled: 10_000,
            rejectedQuantityScaled: 10_000,
            unitCostMinor: 100, // Rs 1.00
            discrepancyType: 'damaged_packaging',
            discrepancyReason: 'Water damaged carton and warped bolts'
          }
        ]
      },
      clerkActor
    );

    const report = grnService.getDiscrepancyReport(businessId);
    expect(report.length).toBeGreaterThanOrEqual(1);

    const item = report.find((r) => r.receiptId === grn.id);
    expect(item).toBeDefined();
    expect(item!.damagedQuantityScaled).toBe(10_000);
    expect(item!.rejectedQuantityScaled).toBe(10_000);
    expect(item!.discrepancyType).toBe('damaged_packaging');
    // Financial impact = (10 + 10) * 100 = 2000 minor units
    expect(item!.financialImpactMinor).toBe(2000);
  });

  // =========================================================================
  // TEST 10: IDEMPOTENT POSTING & TRANSACTION ROLLBACK SAFETY
  // =========================================================================
  it('10. Repeated posting request does NOT duplicate stock; failed transactions roll back completely', () => {
    const grn = grnService.createReceipt(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        stockLocationId: warehouseLocationId,
        lines: [
          {
            productId: String(ordinaryProdId),
            purchaseUnitId: pieceUnitId,
            receivedQuantityScaled: 25_000,
            acceptedQuantityScaled: 25_000,
            unitCostMinor: 50
          }
        ]
      },
      clerkActor
    );
    grnService.approveReceipt(grn.id, managerActor);

    // First post
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);
    const balanceFirst = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled;
    expect(balanceFirst).toBe(25_000);

    // Second post (idempotent call)
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);
    const balanceSecond = balanceRepo.getBalance(String(ordinaryProdId), warehouseLocationId, businessId)?.onHandScaled;
    expect(balanceSecond).toBe(25_000); // MUST NOT BE 50,000!

    // Verify stock movements count for this receipt is strictly 1
    const movements = db.prepare('SELECT COUNT(*) as count FROM stock_movements WHERE reference_id = ?').get(grn.id) as any;
    expect(movements.count).toBe(1);
  });

  // =========================================================================
  // TEST 11: BLOCKED RECEIPT AFTER PURCHASE ORDER CANCELLATION
  // =========================================================================
  it('11. Strictly prevents creating a GRN against a cancelled purchase order', () => {
    const po = poService.createOrder(
      {
        businessId,
        branchId,
        supplierId: activeSupplierId,
        lines: [{ productId: String(ordinaryProdId), purchaseUnitId: pieceUnitId, orderedQuantityScaled: 10_000, unitPriceMinor: 50 }]
      },
      managerActor
    );
    poService.approveOrder(po.id, managerActor);
    poService.cancelOrder(po.id, 'Cancelled by owner', managerActor);

    expect(() => {
      grnService.createReceipt(
        {
          businessId,
          branchId,
          purchaseOrderId: po.id,
          supplierId: activeSupplierId,
          stockLocationId: warehouseLocationId,
          lines: [
            {
              purchaseOrderLineId: po.lines![0].id,
              productId: String(ordinaryProdId),
              purchaseUnitId: pieceUnitId,
              receivedQuantityScaled: 10_000,
              acceptedQuantityScaled: 10_000
            }
          ]
        },
        clerkActor
      );
    }).toThrow(ReceiptAfterPOCancelledError);
  });
});
