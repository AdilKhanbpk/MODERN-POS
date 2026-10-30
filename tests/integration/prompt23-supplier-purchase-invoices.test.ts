import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { PurchaseInvoiceService } from '../../src/application/services/PurchaseInvoiceService';
import { GoodsReceiptService } from '../../src/application/services/GoodsReceiptService';
import { PurchaseOrderService } from '../../src/application/services/PurchaseOrderService';
import { ProductRepository } from '../../src/infrastructure/sqlite/repositories/ProductRepository';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { SupplierRepository } from '../../src/infrastructure/sqlite/repositories/SupplierRepository';
import {
  DuplicateSupplierInvoiceError,
  OverInvoicingError,
  PriceVarianceExceededError,
  ClosedAccountingPeriodError,
  InactiveSupplierError,
  CannotVoidPaidInvoiceError,
  InvoiceAlreadyPostedError,
  InvoiceBeforeGRNNotAllowedError
} from '../../src/domain/purchase/purchase-invoice-rules';
import { PurchaseInvoiceMath } from '../../src/domain/purchase/purchase-invoice-math';

describe('Prompt 23 — Supplier Purchase-Invoice System', () => {
  let db: Database.Database;
  let invoiceService: PurchaseInvoiceService;
  let grnService: GoodsReceiptService;
  let poService: PurchaseOrderService;
  let productRepo: ProductRepository;
  let balanceRepo: StockBalanceRepository;
  let supplierRepo: SupplierRepository;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const warehouseLocationId = '00000000-0000-0000-0000-000000000003';
  const quarantineLocationId = '00000000-0000-0000-0000-000000000004';
  const supplierAId = '00000000-0000-0000-0000-000000000005';
  const supplierBId = '00000000-0000-0000-0000-000000000006';
  const inactiveSupplierId = '00000000-0000-0000-0000-000000000007';

  const clerkActor = { userId: '1', role: 'clerk', isManager: false, businessId };
  const managerActor = { userId: '2', role: 'manager', isManager: true, businessId };

  let boltProdId: number;
  let paintProdId: number;
  let pieceUnitId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    invoiceService = new PurchaseInvoiceService(db);
    grnService = new GoodsReceiptService(db);
    poService = new PurchaseOrderService(db);
    productRepo = new ProductRepository(db);
    balanceRepo = new StockBalanceRepository(db);
    supplierRepo = new SupplierRepository(db);

    // Retrieve standard piece unit
    const pieceUnit = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as any;
    pieceUnitId = String(pieceUnit?.id || '1');

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
      VALUES (?, ?, ?, 'LOC-QUAR', 'Quarantine Area', 'quarantine', 1)
    `).run(quarantineLocationId, businessId, branchId);

    // Seed suppliers
    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-A', 'Apex Industrial Supplies', 1, 100000000, 0)
    `).run(supplierAId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-B', 'Beacon Chemical Corp', 1, 50000000, 0)
    `).run(supplierBId, businessId);

    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, business_id, supplier_code, name, is_active, credit_limit_minor, opening_balance_minor)
      VALUES (?, ?, 'SUPP-INACT', 'Defunct Supply House', 0, 0, 0)
    `).run(inactiveSupplierId, businessId);

    // Seed products
    boltProdId = productRepo.create({
      name: 'High-Tensile Steel Bolts',
      sku: 'SKU-BOLT-100',
      barcode: 'BAR-BOLT-100',
      categoryId: 1,
      costPrice: 100, // 1.00
      sellingPrice: 180,
      currentStock: 0
    });

    paintProdId = productRepo.create({
      name: 'Industrial Epoxy Primer 1L',
      sku: 'SKU-PAINT-01',
      barcode: 'BAR-PAINT-01',
      categoryId: 1,
      costPrice: 5000, // 50.00
      sellingPrice: 7500,
      currentStock: 0
    });

    // Default Purchase Invoice Settings
    invoiceService.configureSettings(businessId, {
      duplicateInvoicePolicy: 'block',
      priceVarianceThresholdMinor: 1000, // Rs 10.00
      priceVarianceThresholdPercent: 5.0, // 5%
      allowInvoiceBeforeGrn: false,
      allowOverInvoicing: false
    });
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // TEST 1: THREE-WAY MATCHING (PO vs GRN vs INVOICE) & PRICE VARIANCE
  // =========================================================================
  it('1. Three-way matching: calculates price & quantity variances accurately and enforces approval thresholds', () => {
    // 1A: Create PO: 100 pieces at 100 minor units
    const po = poService.createOrder({
      businessId,
      branchId,
      supplierId: supplierAId,
      orderDate: '2026-10-30',
      currencyCode: 'PKR',
      items: [{
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        orderedQuantityScaled: 100_000, // 100 units
        unitPriceMinor: 100 // 1.00 each
      }]
    }, clerkActor);
    poService.approveOrder(po.id, managerActor);

    // 1B: Receive via GRN: 100 pieces accepted
    const poLine = po.lines![0];
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      purchaseOrderId: po.id,
      supplierId: supplierAId,
      stockLocationId: warehouseLocationId,
      lines: [{
        purchaseOrderLineId: poLine.id,
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 100_000,
        acceptedQuantityScaled: 100_000,
        unitCostMinor: 100
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    const grnLine = grn.lines![0];

    // 1C: Supplier Invoice arrives charging 100 pieces at 105 minor units (5 unit price variance)
    // Total price variance: 100 * (105 - 100) = 500 minor units
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-SUPP-1001',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grnLine.id,
        purchaseOrderLineId: poLine.id,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 100_000,
        unitPriceMinor: 105
      }]
    }, clerkActor);

    // Perform 3-way match
    const match = invoiceService.performThreeWayMatch(invoice.id);

    expect(match.overallStatus).toBe('acceptable_variance'); // 500 minor < 1000 threshold
    expect(match.totalOrderedQuantityScaled).toBe(100_000);
    expect(match.totalAcceptedQuantityScaled).toBe(100_000);
    expect(match.totalInvoicedQuantityScaled).toBe(100_000);
    expect(match.totalPriceVarianceMinor).toBe(500); // 100 * (105 - 100) = 500
    expect(match.requiresManagerApproval).toBe(false);

    // 1D: Now test threshold breach: Supplier charges 120 minor units
    // Total price variance: 100 * (120 - 100) = 2,000 minor units > 1,000 threshold
    const highInvoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-SUPP-1002',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grnLine.id,
        purchaseOrderLineId: poLine.id,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 100_000,
        unitPriceMinor: 120
      }]
    }, clerkActor);

    const highMatch = invoiceService.performThreeWayMatch(highInvoice.id);
    expect(highMatch.overallStatus).toBe('variance_exceeded');
    expect(highMatch.totalPriceVarianceMinor).toBe(2000);
    expect(highMatch.requiresManagerApproval).toBe(true);

    // Posting by non-manager clerk is blocked
    expect(() => {
      invoiceService.postInvoice({ purchaseInvoiceId: highInvoice.id }, clerkActor);
    }).toThrow(PriceVarianceExceededError);

    // Posting with manager approval succeeds
    const posted = invoiceService.postInvoice(
      { purchaseInvoiceId: highInvoice.id, managerApproved: true },
      managerActor
    );
    expect(posted.status).toBe('posted');
  });

  // =========================================================================
  // TEST 2: STOCK IMMUTABILITY (NEVER CREATE STOCK AGAIN ON INVOICE POSTING)
  // =========================================================================
  it('2. Stock immutability: posting purchase invoice never alters or duplicates physical stock', () => {
    // Receive 50 units via GRN
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierAId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 50_000,
        acceptedQuantityScaled: 50_000,
        unitCostMinor: 100
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    // Physical stock is now 50
    const stockAfterGrn = balanceRepo.getBalance(businessId, String(boltProdId), warehouseLocationId);
    expect(stockAfterGrn?.onHandScaled).toBe(50_000);
    const prodAfterGrn = productRepo.findById(boltProdId)!;
    expect(prodAfterGrn.currentStock).toBe(50);

    // Create and post Invoice for these 50 units
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-BILL-50',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grn.lines![0].id,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 50_000,
        unitPriceMinor: 100
      }]
    }, clerkActor);

    invoiceService.postInvoice({ purchaseInvoiceId: invoice.id }, managerActor);

    // Verify stock is STRICTLY UNCHANGED
    const stockAfterInvoice = balanceRepo.getBalance(businessId, String(boltProdId), warehouseLocationId);
    expect(stockAfterInvoice?.onHandScaled).toBe(50_000); // Exactly 50, NOT 100!
    const prodAfterInvoice = productRepo.findById(boltProdId)!;
    expect(prodAfterInvoice.currentStock).toBe(50); // Exactly 50!
  });

  // =========================================================================
  // TEST 3: SUPPLIER PAYABLE LEDGER POSTING
  // =========================================================================
  it('3. Financial posting: records CREDIT entry in supplier ledger and updates payable balance', () => {
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierAId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 200_000, // 200 units
        acceptedQuantityScaled: 200_000,
        unitCostMinor: 150 // 1.50 each
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    const initialPayable = supplierRepo.calculateLedgerBalance(supplierAId);

    // Invoice: 200 units * 150 = 30,000 minor units (Rs 300.00) + 2,000 shipping (Rs 20.00) = 32,000 minor units
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-PAYABLE-01',
      invoiceDate: '2026-10-30',
      shippingMinor: 2000,
      lines: [{
        goodsReceiptLineId: grn.lines![0].id,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 200_000,
        unitPriceMinor: 150
      }]
    }, clerkActor);

    expect(invoice.totalMinor).toBe(32_000);

    invoiceService.postInvoice({ purchaseInvoiceId: invoice.id }, managerActor);

    // Verify supplier ledger contains CREDIT of 32,000
    const finalPayable = supplierRepo.calculateLedgerBalance(supplierAId);
    expect(finalPayable - initialPayable).toBe(32_000);

    const ledgerRows = db.prepare(`
      SELECT * FROM supplier_ledger_entries
      WHERE supplier_id = ? AND source_type = 'purchase_invoice' AND source_id = ?
    `).all(supplierAId, invoice.id) as any[];

    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].credit_minor).toBe(32_000);
    expect(ledgerRows[0].debit_minor).toBe(0);
  });

  // =========================================================================
  // TEST 4: PARTIAL INVOICING ACROSS MULTIPLE INVOICES & OVER-INVOICING GUARD
  // =========================================================================
  it('4. Partial invoicing: permits multiple partial invoices against a single GRN and blocks over-invoicing', () => {
    // GRN accepted: 100 units
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierAId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 100_000,
        acceptedQuantityScaled: 100_000,
        unitCostMinor: 100
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    const grnLineId = grn.lines![0].id;

    // Invoice 1: Bills 40 units
    const inv1 = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-PARTIAL-1',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grnLineId,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 40_000,
        unitPriceMinor: 100
      }]
    }, clerkActor);
    invoiceService.postInvoice({ purchaseInvoiceId: inv1.id }, managerActor);

    expect(invoiceService.getSettings(businessId)?.allowOverInvoicing).toBe(false);
    expect(invoiceService.getSettings(businessId)?.duplicateInvoicePolicy).toBe('block');

    // Total invoiced so far is 40 units
    expect(db.prepare(`
      SELECT COALESCE(SUM(allocated_quantity_scaled), 0) as tot
      FROM purchase_invoice_receipt_allocations WHERE goods_receipt_line_id = ?
    `).get(grnLineId)).toEqual({ tot: 40_000 });

    // Invoice 2: Bills remaining 60 units
    const inv2 = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-PARTIAL-2',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grnLineId,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 60_000,
        unitPriceMinor: 100
      }]
    }, clerkActor);
    invoiceService.postInvoice({ purchaseInvoiceId: inv2.id }, managerActor);

    // Total invoiced is now 100 units (fully invoiced)
    expect(db.prepare(`
      SELECT COALESCE(SUM(allocated_quantity_scaled), 0) as tot
      FROM purchase_invoice_receipt_allocations WHERE goods_receipt_line_id = ?
    `).get(grnLineId)).toEqual({ tot: 100_000 });

    // Invoice 3: Attempting to bill even 1 more unit throws OverInvoicingError
    expect(() => {
      invoiceService.createInvoice({
        businessId,
        branchId,
        supplierId: supplierAId,
        supplierInvoiceNumber: 'INV-PARTIAL-EXCESS',
        invoiceDate: '2026-10-30',
        lines: [{
          goodsReceiptLineId: grnLineId,
          productId: boltProdId,
          unitId: pieceUnitId,
          quantityScaled: 1_000, // 1 extra unit
          unitPriceMinor: 100
        }]
      }, clerkActor);
    }).toThrow(OverInvoicingError);
  });

  // =========================================================================
  // TEST 5: MULTI-GRN INVOICE CONSOLIDATION & ALLOCATION
  // =========================================================================
  it('5. Multi-receipt invoicing: consolidates multiple GRNs into a single invoice with distinct line allocations', () => {
    // Delivery 1: 30 units of Paint
    const grn1 = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierBId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: paintProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 30_000,
        acceptedQuantityScaled: 30_000,
        unitCostMinor: 5000
      }]
    }, clerkActor);
    grnService.approveReceipt(grn1.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn1.id }, managerActor);

    // Delivery 2: 50 units of Paint
    const grn2 = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierBId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: paintProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 50_000,
        acceptedQuantityScaled: 50_000,
        unitCostMinor: 5000
      }]
    }, clerkActor);
    grnService.approveReceipt(grn2.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn2.id }, managerActor);

    // Import from both receipts
    const imported = invoiceService.importFromGoodsReceipts([grn1.id, grn2.id], businessId);
    expect(imported.lines.length).toBe(2);
    expect(imported.lines[0].quantityScaled).toBe(30_000);
    expect(imported.lines[1].quantityScaled).toBe(50_000);

    // Create consolidated invoice
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierBId,
      supplierInvoiceNumber: 'INV-CONSOLIDATED-01',
      invoiceDate: '2026-10-30',
      lines: imported.lines.map(l => ({
        goodsReceiptLineId: l.goodsReceiptLineId,
        productId: l.productId,
        unitId: l.unitId,
        quantityScaled: l.quantityScaled,
        unitPriceMinor: l.unitPriceMinor
      }))
    }, clerkActor);

    const posted = invoiceService.postInvoice({ purchaseInvoiceId: invoice.id }, managerActor);
    expect(posted.status).toBe('posted');

    // Total invoiced: 30*5000 + 50*5000 = 400,000 minor units
    expect(posted.totalMinor).toBe(400_000);

    // Verify allocations table has 2 entries linking to grn1 and grn2
    const allocations = db.prepare(`
      SELECT * FROM purchase_invoice_receipt_allocations
      WHERE purchase_invoice_line_id IN (${posted.lines!.map(() => '?').join(',')})
    `).all(...posted.lines!.map(l => l.id)) as any[];

    expect(allocations.length).toBe(2);
  });

  // =========================================================================
  // TEST 6: PROVISIONAL COST RECONCILIATION WITHOUT ALTERING STOCK
  // =========================================================================
  it('6. Inventory valuation: reconciles provisional GRN cost layer when final invoiced price differs', () => {
    // GRN receives at provisional cost Rs 50.00 (5,000 minor)
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierBId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: paintProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 20_000,
        acceptedQuantityScaled: 20_000,
        unitCostMinor: 5000
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    // Verify initial FIFO cost layer has unit_cost_minor = 5000
    const initialLayer = db.prepare(`
      SELECT * FROM inventory_cost_layers WHERE product_id = ?
    `).get(String(paintProdId)) as any;
    expect(initialLayer).toBeDefined();
    expect(initialLayer.unit_cost_minor).toBe(5000);

    // Supplier invoice arrives billing at negotiated Rs 48.00 (4,800 minor)
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierBId,
      supplierInvoiceNumber: 'INV-DISCOUNT-48',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grn.lines![0].id,
        productId: paintProdId,
        unitId: pieceUnitId,
        quantityScaled: 20_000,
        unitPriceMinor: 4800
      }]
    }, clerkActor);

    invoiceService.postInvoice({
      purchaseInvoiceId: invoice.id,
      reconcileCostLayers: true
    }, managerActor);

    // Verify FIFO cost layer was reconciled to 4800
    const reconciledLayer = db.prepare(`
      SELECT * FROM inventory_cost_layers WHERE product_id = ?
    `).get(String(paintProdId)) as any;
    expect(reconciledLayer.unit_cost_minor).toBe(4800);
  });

  // =========================================================================
  // TEST 7: DUPLICATE INVOICE NUMBER PREVENTION
  // =========================================================================
  it('7. Duplicate detection: blocks duplicate supplier invoice numbers per supplier under block policy', () => {
    const grn = grnService.createReceipt({
      businessId,
      branchId,
      supplierId: supplierAId,
      stockLocationId: warehouseLocationId,
      lines: [{
        productId: boltProdId,
        purchaseUnitId: pieceUnitId,
        receivedQuantityScaled: 10_000,
        acceptedQuantityScaled: 10_000,
        unitCostMinor: 100
      }]
    }, clerkActor);
    grnService.approveReceipt(grn.id, managerActor);
    grnService.postReceipt({ goodsReceiptId: grn.id }, managerActor);

    // First invoice with 'BILL-UNIQUE-99' succeeds
    invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'BILL-UNIQUE-99',
      invoiceDate: '2026-10-30',
      lines: [{
        goodsReceiptLineId: grn.lines![0].id,
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 10_000,
        unitPriceMinor: 100
      }]
    }, clerkActor);

    // Duplicate invoice for Supplier A with same supplierInvoiceNumber throws DuplicateSupplierInvoiceError
    expect(() => {
      invoiceService.createInvoice({
        businessId,
        branchId,
        supplierId: supplierAId,
        supplierInvoiceNumber: 'BILL-UNIQUE-99',
        invoiceDate: '2026-10-30',
        lines: [{
          productId: boltProdId,
          unitId: pieceUnitId,
          quantityScaled: 10_000,
          unitPriceMinor: 100
        }]
      }, clerkActor);
    }).toThrow(DuplicateSupplierInvoiceError);

    // But Supplier B using 'BILL-UNIQUE-99' is allowed (different supplier)
    const suppBInvoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierBId,
      supplierInvoiceNumber: 'BILL-UNIQUE-99',
      invoiceDate: '2026-10-30',
      lines: [{
        productId: paintProdId,
        unitId: pieceUnitId,
        quantityScaled: 5_000,
        unitPriceMinor: 5000
      }]
    }, managerActor);
    expect(suppBInvoice.supplierInvoiceNumber).toBe('BILL-UNIQUE-99');
  });

  // =========================================================================
  // TEST 8: CURRENCY CONVERSION (EXCHANGE RATE NUMERATOR / DENOMINATOR)
  // =========================================================================
  it('8. Multi-currency: converts foreign invoice currency to base currency minor using exact arithmetic', () => {
    // Invoicing before GRN enabled for foreign import
    invoiceService.configureSettings(businessId, { allowInvoiceBeforeGrn: true });

    // 100 USD at 280 PKR / 1 USD
    // Subtotal: 100.00 USD (10,000 minor) * 280 / 1 = 2,800,000 PKR minor (Rs 28,000.00)
    const usdInvoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-IMPORT-USD-01',
      invoiceDate: '2026-10-30',
      currencyCode: 'USD',
      exchangeRateNumerator: 280,
      exchangeRateDenominator: 1,
      lines: [{
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 100_000, // 100 units
        unitPriceMinor: 100 // $1.00 each
      }]
    }, clerkActor);

    expect(usdInvoice.totalMinor).toBe(10_000); // In foreign USD minor

    const initialPayable = supplierRepo.calculateLedgerBalance(supplierAId);
    invoiceService.postInvoice({ purchaseInvoiceId: usdInvoice.id }, managerActor);

    // Verify supplier ledger recorded converted PKR amount: 10,000 * 280 = 2,800,000 minor
    const finalPayable = supplierRepo.calculateLedgerBalance(supplierAId);
    expect(finalPayable - initialPayable).toBe(2_800_000);
  });

  // =========================================================================
  // TEST 9: CLOSED ACCOUNTING PERIOD PROTECTION
  // =========================================================================
  it('9. Period cutoff: blocks invoice creation or posting within closed accounting periods', () => {
    invoiceService.configureSettings(businessId, { allowInvoiceBeforeGrn: true });

    // Create and close period for September 2026
    const period = invoiceService.createAccountingPeriod({
      businessId,
      periodName: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      isClosed: true
    });

    expect(period.isClosed).toBe(true);

    // Attempting to create invoice dated 2026-09-15 is rejected
    expect(() => {
      invoiceService.createInvoice({
        businessId,
        branchId,
        supplierId: supplierAId,
        supplierInvoiceNumber: 'INV-SEP-BACKDATE',
        invoiceDate: '2026-09-15',
        lines: [{
          productId: boltProdId,
          unitId: pieceUnitId,
          quantityScaled: 10_000,
          unitPriceMinor: 100
        }]
      }, clerkActor);
    }).toThrow(ClosedAccountingPeriodError);
  });

  // =========================================================================
  // TEST 10: NON-STOCK AND SERVICE-ONLY INVOICES
  // =========================================================================
  it('10. Service charges: supports invoices with only shipping/freight or non-stock lines', () => {
    invoiceService.configureSettings(businessId, { allowInvoiceBeforeGrn: true });

    const freightInvoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-FREIGHT-ONLY',
      invoiceDate: '2026-10-30',
      shippingMinor: 15_000, // Rs 150.00
      otherChargesMinor: 2_500, // Rs 25.00
      lines: [] // 0 stock lines
    }, managerActor);

    expect(freightInvoice.totalMinor).toBe(17_500);

    const posted = invoiceService.postInvoice({ purchaseInvoiceId: freightInvoice.id }, managerActor);
    expect(posted.status).toBe('posted');

    // Supplier payable incremented by 17,500
    const sle = db.prepare(`
      SELECT * FROM supplier_ledger_entries WHERE source_id = ?
    `).get(freightInvoice.id) as any;
    expect(sle.credit_minor).toBe(17_500);
  });

  // =========================================================================
  // TEST 11: PAYMENT ALLOCATION WORKFLOW & INVOICE VOIDING CONSTRAINTS
  // =========================================================================
  it('11. Payments & Voiding: transitions status through payment allocations and prevents voiding paid invoices', () => {
    invoiceService.configureSettings(businessId, { allowInvoiceBeforeGrn: true });

    // Invoice of Rs 100.00 (10,000 minor)
    const invoice = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-PAY-CYCLE-01',
      invoiceDate: '2026-10-30',
      lines: [{
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 100_000,
        unitPriceMinor: 100
      }]
    }, managerActor);

    invoiceService.postInvoice({ purchaseInvoiceId: invoice.id }, managerActor);
    expect(invoiceService.findById(invoice.id)?.status).toBe('posted');

    // 11A: Partial Payment of Rs 40.00 (4,000 minor)
    invoiceService.allocatePayment({
      purchaseInvoiceId: invoice.id,
      amountMinor: 4000,
      paymentMethod: 'CASH'
    }, clerkActor);

    const partPaid = invoiceService.findById(invoice.id)!;
    expect(partPaid.status).toBe('partially_paid');
    expect(partPaid.paidMinor).toBe(4000);
    expect(partPaid.outstandingMinor).toBe(6000);

    // 11B: Attempting to void paid invoice is blocked
    expect(() => {
      invoiceService.voidInvoice(invoice.id, 'Accidental bill', managerActor);
    }).toThrow(CannotVoidPaidInvoiceError);

    // 11C: Final payment of remaining Rs 60.00 (6,000 minor)
    invoiceService.allocatePayment({
      purchaseInvoiceId: invoice.id,
      amountMinor: 6000,
      paymentMethod: 'BANK_TRANSFER'
    }, clerkActor);

    const fullyPaid = invoiceService.findById(invoice.id)!;
    expect(fullyPaid.status).toBe('paid');
    expect(fullyPaid.outstandingMinor).toBe(0);

    // 11D: Test voiding an UNPAID posted invoice
    const unpaidInv = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-VOID-UNPAID',
      invoiceDate: '2026-10-30',
      lines: [{
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 10_000,
        unitPriceMinor: 100
      }]
    }, managerActor);
    invoiceService.postInvoice({ purchaseInvoiceId: unpaidInv.id }, managerActor);

    const payableBeforeVoid = supplierRepo.calculateLedgerBalance(supplierAId);
    invoiceService.voidInvoice(unpaidInv.id, 'Wrong vendor selected', managerActor);

    const voided = invoiceService.findById(unpaidInv.id)!;
    expect(voided.status).toBe('voided');

    // Payable is restored (reduced by 1,000)
    const payableAfterVoid = supplierRepo.calculateLedgerBalance(supplierAId);
    expect(payableBeforeVoid - payableAfterVoid).toBe(1000);
  });

  // =========================================================================
  // TEST 12: INACTIVE SUPPLIER GUARD & IDEMPOTENCY
  // =========================================================================
  it('12. Inactive supplier guard & idempotent posting', () => {
    invoiceService.configureSettings(businessId, { allowInvoiceBeforeGrn: true });

    // Block creating invoice for inactive supplier
    expect(() => {
      invoiceService.createInvoice({
        businessId,
        branchId,
        supplierId: inactiveSupplierId,
        supplierInvoiceNumber: 'INV-INACT-01',
        invoiceDate: '2026-10-30',
        lines: [{
          productId: boltProdId,
          unitId: pieceUnitId,
          quantityScaled: 10_000,
          unitPriceMinor: 100
        }]
      }, clerkActor);
    }).toThrow(InactiveSupplierError);

    // Idempotent posting: calling postInvoice twice does NOT duplicate ledger entries
    const inv = invoiceService.createInvoice({
      businessId,
      branchId,
      supplierId: supplierAId,
      supplierInvoiceNumber: 'INV-IDEMP-01',
      invoiceDate: '2026-10-30',
      lines: [{
        productId: boltProdId,
        unitId: pieceUnitId,
        quantityScaled: 10_000,
        unitPriceMinor: 100
      }]
    }, managerActor);

    const post1 = invoiceService.postInvoice({ purchaseInvoiceId: inv.id }, managerActor);
    const post2 = invoiceService.postInvoice({ purchaseInvoiceId: inv.id }, managerActor);

    expect(post1.status).toBe('posted');
    expect(post2.status).toBe('posted');

    const ledgerEntries = db.prepare(`
      SELECT * FROM supplier_ledger_entries WHERE source_id = ?
    `).all(inv.id);
    expect(ledgerEntries.length).toBe(1); // Exactly 1 ledger entry, NOT duplicated!
  });
});
