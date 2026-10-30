import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import {
  StockTransferService,
  InsufficientSourceStockError,
  CrossBranchTransferDisabledError,
  CrossBranchMismatchError,
  TransferOverReceiptError,
  InvalidTransferStateError,
  TransferImmutabilityError
} from '../../src/application/services/StockTransferService';
import { StockLocationService } from '../../src/application/services/StockLocationService';
import { StockBalanceRepository } from '../../src/infrastructure/sqlite/repositories/StockBalanceRepository';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { ModuleManager } from '../../src/application/modules/ModuleManager';
import { defaultModuleRegistry } from '../../src/application/modules/ModuleRegistry';

describe('Prompt 15 — Enterprise Stock-Transfer Workflow & In-Transit Tracking', () => {
  let db: Database.Database;
  let transferService: StockTransferService;
  let locationService: StockLocationService;
  let balanceRepo: StockBalanceRepository;
  let catalogService: ProductCatalogService;
  let moduleManager: ModuleManager;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branch1Id = '00000000-0000-0000-0000-000000000002';
  const branch2Id = '00000000-0000-0000-0000-000000000003';

  const ownerActor = { userId: '1', role: 'owner', businessId };
  const managerActor = { userId: '2', role: 'manager', businessId };
  const cashierActor = { userId: '3', role: 'cashier', businessId };

  let locStoreroomBranch1: string;
  let locShopFloorBranch1: string;
  let locDamagedBranch1: string;
  let locWarehouseBranch2: string;
  let unitPieceId: string;

  const setStock = (productId: string, locationId: string, qtyScaled: number) => {
    balanceRepo.upsertDelta({
      businessId,
      productId,
      stockLocationId: locationId,
      onHandDeltaScaled: qtyScaled
    });
    db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(qtyScaled / 1000, productId);
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    moduleManager = new ModuleManager(db, defaultModuleRegistry);
    transferService = new StockTransferService(db, moduleManager);
    locationService = new StockLocationService(db);
    balanceRepo = new StockBalanceRepository(db);
    catalogService = new ProductCatalogService(db);

    // Seed test users
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES 
        ('1', ?, 'owner_user', 'hash', 'Owner User', 1),
        ('2', ?, 'manager_user', 'hash', 'Manager User', 1),
        ('3', ?, 'cashier_user', 'hash', 'Cashier User', 1)
    `).run(businessId, businessId, businessId);

    // Seed second branch
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, name, code, is_active)
      VALUES (?, ?, 'Branch Two - North', 'BR-02', 1)
    `).run(branch2Id, businessId);

    // Seed Unit of measurement
    const unitRow = db.prepare('SELECT id FROM units WHERE name = ?').get('Piece') as { id: string };
    unitPieceId = unitRow.id;

    // Seed Stock Locations:
    // 1. Branch 1 Storeroom
    const sl1 = locationService.createLocation({
      businessId,
      branchId: branch1Id,
      name: 'Central Storeroom',
      code: 'BR1-STORE',
      locationType: 'warehouse',
      isSellable: false,
      isReceivable: true
    }, ownerActor);
    locStoreroomBranch1 = sl1.id;

    // 2. Branch 1 Shop Floor
    const sl2 = locationService.createLocation({
      businessId,
      branchId: branch1Id,
      name: 'Main Sales Floor',
      code: 'BR1-FLOOR',
      locationType: 'shop_floor',
      isSellable: true,
      isReceivable: true
    }, ownerActor);
    locShopFloorBranch1 = sl2.id;

    // 3. Branch 1 Damaged / Quarantine
    const sl3 = locationService.createLocation({
      businessId,
      branchId: branch1Id,
      name: 'Damaged & Quarantine',
      code: 'BR1-DAMAGED',
      locationType: 'damaged',
      isSellable: false,
      isReceivable: true
    }, ownerActor);
    locDamagedBranch1 = sl3.id;

    // 4. Branch 2 Warehouse
    const sl4 = locationService.createLocation({
      businessId,
      branchId: branch2Id,
      name: 'Branch 2 Warehouse',
      code: 'BR2-WH',
      locationType: 'warehouse',
      isSellable: false,
      isReceivable: true
    }, ownerActor);
    locWarehouseBranch2 = sl4.id;
  });

  // =========================================================================
  // 1. CREATION, SCOPING & STOCK VALIDATION
  // =========================================================================
  describe('1. Creation, Scoping & Stock Validation', () => {
    it('creates an internal stock transfer request and generates sequential TRF number', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'RICE-BAS-1KG',
        name: 'Basmati Rice 1kg',
        baseUnitId: unitPieceId,
        costPrice: 20000,
        retailPriceMinor: 25000
      });

      setStock(prod.id, locStoreroomBranch1, 50000); // 50 units in storeroom

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 20000 }], // 20 units
          autoSubmit: true
        },
        managerActor
      );

      expect(transfer.id).toBeDefined();
      expect(transfer.transferNumber).toMatch(/^TRF-\d{4}-\d{5}$/);
      expect(transfer.transferType).toBe('internal');
      expect(transfer.status).toBe('requested');
      expect(transfer.lines?.length).toBe(1);
      expect(transfer.lines?.[0].requestedQuantityScaled).toBe(20000);
      expect(transfer.lines?.[0].unitCostMinor).toBe(20000);
    });

    it('rejects transfer between identical source and destination locations', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SUGAR-1KG',
        name: 'Sugar 1kg',
        baseUnitId: unitPieceId
      });

      expect(() => {
        transferService.createTransfer(
          {
            businessId,
            sourceLocationId: locStoreroomBranch1,
            destinationLocationId: locStoreroomBranch1,
            lines: [{ productId: prod.id, requestedQuantityScaled: 5000 }]
          },
          managerActor
        );
      }).toThrowError(/cannot be the same/i);
    });

    it('rejects transfer when source location has insufficient available stock', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'OIL-CAN-5L',
        name: 'Cooking Oil 5L',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 10000); // 10 units available

      expect(() => {
        transferService.createTransfer(
          {
            businessId,
            sourceLocationId: locStoreroomBranch1,
            destinationLocationId: locShopFloorBranch1,
            lines: [{ productId: prod.id, requestedQuantityScaled: 15000 }] // Requesting 15 units
          },
          managerActor
        );
      }).toThrowError(InsufficientSourceStockError);
    });
  });

  // =========================================================================
  // 2. INTER-BRANCH TRANSFERS & MULTI-BRANCH MODULE GATING
  // =========================================================================
  describe('2. Inter-Branch Transfers & Multi-Branch Module Gating', () => {
    it('strictly prohibits cross-branch transfer when multi_branch module is disabled', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'TEA-BOX-500G',
        name: 'Black Tea 500g',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 100000);

      // Attempt transfer between Branch 1 and Branch 2 while multi_branch is disabled
      expect(() => {
        transferService.createTransfer(
          {
            businessId,
            sourceLocationId: locStoreroomBranch1,
            destinationLocationId: locWarehouseBranch2,
            lines: [{ productId: prod.id, requestedQuantityScaled: 25000 }]
          },
          managerActor
        );
      }).toThrowError(CrossBranchTransferDisabledError);
    });

    it('allows cross-branch transfer when multi_branch module is active', () => {
      // Enable multi_branch module
      moduleManager.installModule(businessId, 'multi_branch');
      moduleManager.enableModule(businessId, 'multi_branch');

      const prod = catalogService.createProduct({
        businessId,
        sku: 'FLOUR-10KG',
        name: 'Wheat Flour 10kg',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 100000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locWarehouseBranch2,
          lines: [{ productId: prod.id, requestedQuantityScaled: 30000 }],
          autoSubmit: true
        },
        managerActor
      );

      expect(transfer.transferType).toBe('inter_branch');
      expect(transfer.destinationBranchId).toBe(branch2Id);
    });

    it('rejects cross-branch transfer falsely declared as an internal transfer', () => {
      moduleManager.installModule(businessId, 'multi_branch');
      moduleManager.enableModule(businessId, 'multi_branch');

      const prod = catalogService.createProduct({
        businessId,
        sku: 'SALT-1KG',
        name: 'Table Salt 1kg',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 50000);

      expect(() => {
        transferService.createTransfer(
          {
            businessId,
            sourceLocationId: locStoreroomBranch1,
            destinationLocationId: locWarehouseBranch2,
            transferType: 'internal' as any,
            lines: [{ productId: prod.id, requestedQuantityScaled: 10000 }]
          },
          managerActor
        );
      }).toThrowError(CrossBranchMismatchError);
    });
  });

  // =========================================================================
  // 3. DISPATCH & IN-TRANSIT CONSERVATION OF INVENTORY
  // =========================================================================
  describe('3. Dispatch & In-Transit Conservation of Inventory', () => {
    it('moves stock to in-transit, decrements source, and preserves total business inventory', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'BISCUIT-PACK',
        name: 'Digestive Biscuits',
        baseUnitId: unitPieceId,
        costPrice: 5000
      });

      setStock(prod.id, locStoreroomBranch1, 100000); // 100 units

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 40000 }],
          autoSubmit: true
        },
        managerActor
      );

      // Approve transfer
      transferService.approveTransfer(transfer.id, ownerActor);

      // Dispatch transfer
      const dispatched = transferService.dispatchTransfer(
        { transferId: transfer.id },
        managerActor
      );

      expect(dispatched.status).toBe('dispatched');
      expect(dispatched.dispatchedAt).toBeDefined();

      // Check Balances:
      // Source storeroom: 100 - 40 = 60 units
      const srcBal = balanceRepo.getBalance(prod.id, locStoreroomBranch1, businessId);
      expect(srcBal?.onHandScaled).toBe(60000);

      // Destination shop floor: not yet received (0 units)
      const destBal = balanceRepo.getBalance(prod.id, locShopFloorBranch1, businessId);
      expect(destBal?.onHandScaled || 0).toBe(0);

      // In-transit location: exactly 40 units
      const inTransitId = dispatched.inTransitLocationId!;
      const transitBal = balanceRepo.getBalance(prod.id, inTransitId, businessId);
      expect(transitBal?.onHandScaled).toBe(40000);

      // Total business stock strictly preserved: 60 + 0 + 40 = 100 units!
      const totalStock = (srcBal?.onHandScaled || 0) + (destBal?.onHandScaled || 0) + (transitBal?.onHandScaled || 0);
      expect(totalStock).toBe(100000);

      // In-transit location has is_sellable = 0
      const transitLocRow = db.prepare('SELECT is_sellable, is_receivable FROM stock_locations WHERE id = ?').get(inTransitId) as any;
      expect(transitLocRow.is_sellable).toBe(0);

      // Verify stock movements recorded: paired dispatch movements
      const movements = db.prepare(`
        SELECT movement_type, direction, stock_location_id, quantity_scaled, unit_cost_minor
        FROM stock_movements
        WHERE reference_id = ?
        ORDER BY rowid ASC
      `).all(transfer.id) as any[];

      expect(movements.length).toBe(2);
      expect(movements[0].movement_type).toBe('TRANSFER_DISPATCH');
      expect(movements[0].direction).toBe('OUT');
      expect(movements[0].stock_location_id).toBe(locStoreroomBranch1);
      expect(movements[0].quantity_scaled).toBe(40000);
      expect(movements[0].unit_cost_minor).toBe(5000);

      expect(movements[1].movement_type).toBe('TRANSFER_DISPATCH');
      expect(movements[1].direction).toBe('IN');
      expect(movements[1].stock_location_id).toBe(inTransitId);
      expect(movements[1].quantity_scaled).toBe(40000);
    });
  });

  // =========================================================================
  // 4. FULL RECEIPT & COMPLETION
  // =========================================================================
  describe('4. Full Receipt & Completion', () => {
    it('receives all dispatched items into destination location and transitions to received', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'MILK-TETRA-1L',
        name: 'Whole Milk 1L',
        baseUnitId: unitPieceId,
        costPrice: 18000
      });

      setStock(prod.id, locStoreroomBranch1, 80000); // 80 units

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 50000 }],
          autoSubmit: true
        },
        managerActor
      );

      transferService.approveTransfer(transfer.id, ownerActor);
      const dispatched = transferService.dispatchTransfer({ transferId: transfer.id }, managerActor);

      const inTransitId = dispatched.inTransitLocationId!;
      const lineId = dispatched.lines![0].id;

      // Full receipt into destination
      const received = transferService.receiveTransfer(
        {
          transferId: transfer.id,
          lines: [{ lineId, receivedQuantityScaled: 50000 }],
          notes: 'Full delivery received in good condition'
        },
        managerActor
      );

      expect(received.status).toBe('received');
      expect(received.receivedAt).toBeDefined();

      // Check Balances:
      // In-transit: 0 units
      const transitBal = balanceRepo.getBalance(prod.id, inTransitId, businessId);
      expect(transitBal?.onHandScaled).toBe(0);

      // Destination: 50 units
      const destBal = balanceRepo.getBalance(prod.id, locShopFloorBranch1, businessId);
      expect(destBal?.onHandScaled).toBe(50000);

      // Audit receipts created
      const receipts = transferService.getTransferById(transfer.id)?.receipts || [];
      expect(receipts.length).toBe(1);
      const firstReceipt = receipts[0];
      expect(firstReceipt?.lines?.[0]?.receivedQuantityScaled).toBe(50000);

      // Movement recorded
      const rcvMovement = db.prepare(`
        SELECT movement_type, direction, stock_location_id, quantity_scaled
        FROM stock_movements
        WHERE reference_id = ? AND movement_type = 'TRANSFER_RECEIPT'
      `).get(transfer.id) as any;

      expect(rcvMovement).toBeDefined();
      expect(rcvMovement.direction).toBe('IN');
      expect(rcvMovement.stock_location_id).toBe(locShopFloorBranch1);
      expect(rcvMovement.quantity_scaled).toBe(50000);
    });
  });

  // =========================================================================
  // 5. PARTIAL RECEIPT, REJECTIONS & DISCREPANCY LOSS (PROMPT 15 SPEC)
  // =========================================================================
  describe('5. Partial Receipts, Rejections & Discrepancy Loss', () => {
    it('handles multi-stage partial receipts with damaged rejection and missing loss write-off', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'JUICE-ORANGE-1L',
        name: 'Orange Juice 1L',
        baseUnitId: unitPieceId,
        costPrice: 12000
      });

      // Dispatched 100 units
      setStock(prod.id, locStoreroomBranch1, 100000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 100000 }],
          autoSubmit: true
        },
        managerActor
      );

      transferService.approveTransfer(transfer.id, ownerActor);
      const dispatched = transferService.dispatchTransfer({ transferId: transfer.id }, managerActor);
      const inTransitId = dispatched.inTransitLocationId!;
      const lineId = dispatched.lines![0].id;

      // Stage 1: Partial Receipt of 60 units (40 remaining in transit)
      const part1 = transferService.receiveTransfer(
        {
          transferId: transfer.id,
          lines: [{ lineId, receivedQuantityScaled: 60000 }],
          notes: 'First delivery crate received'
        },
        managerActor
      );

      expect(part1.status).toBe('partially_received');
      expect(balanceRepo.getBalance(prod.id, locShopFloorBranch1, businessId)?.onHandScaled).toBe(60000);
      expect(balanceRepo.getBalance(prod.id, inTransitId, businessId)?.onHandScaled).toBe(40000);

      // Attempting to receive 45 units now -> OVER-RECEIPT ERROR! (40 + 60 = 105 > 100)
      expect(() => {
        transferService.receiveTransfer(
          {
            transferId: transfer.id,
            lines: [{ lineId, receivedQuantityScaled: 45000 }]
          },
          managerActor
        );
      }).toThrowError(TransferOverReceiptError);

      // Stage 2: Receipt of remaining 40 units:
      // - 36 accepted into Sales Floor
      // - 2 rejected (damaged bottles, routed to Damaged / Quarantine location)
      // - 2 missing/lost in transit (written off with TRANSFER_LOSS movement)
      const part2 = transferService.receiveTransfer(
        {
          transferId: transfer.id,
          lines: [
            {
              lineId,
              receivedQuantityScaled: 36000,
              rejectedQuantityScaled: 2000,
              lossQuantityScaled: 2000,
              rejectedLocationId: locDamagedBranch1,
              discrepancyReason: '2 damaged bottles, 2 missing cartons'
            }
          ],
          notes: 'Final delivery crate reconciled'
        },
        managerActor
      );

      // All 100 units are now accounted for: 60 + 36 + 2 + 2 = 100
      expect(part2.status).toBe('received');

      // Check Final Balances:
      // 1. In-Transit balance is 0
      expect(balanceRepo.getBalance(prod.id, inTransitId, businessId)?.onHandScaled).toBe(0);

      // 2. Sales floor has 60 + 36 = 96 units
      expect(balanceRepo.getBalance(prod.id, locShopFloorBranch1, businessId)?.onHandScaled).toBe(96000);

      // 3. Damaged quarantine location has 2 units
      expect(balanceRepo.getBalance(prod.id, locDamagedBranch1, businessId)?.onHandScaled).toBe(2000);

      // Check movements:
      // Damaged movement: TRANSFER_REJECTED
      const rejMovement = db.prepare(`
        SELECT movement_type, direction, stock_location_id, quantity_scaled
        FROM stock_movements
        WHERE reference_id = ? AND movement_type = 'TRANSFER_REJECTED'
      `).get(transfer.id) as any;

      expect(rejMovement).toBeDefined();
      expect(rejMovement.stock_location_id).toBe(locDamagedBranch1);
      expect(rejMovement.quantity_scaled).toBe(2000);

      // Loss movement: TRANSFER_LOSS
      const lossMovement = db.prepare(`
        SELECT movement_type, direction, stock_location_id, quantity_scaled
        FROM stock_movements
        WHERE reference_id = ? AND movement_type = 'TRANSFER_LOSS'
      `).get(transfer.id) as any;

      expect(lossMovement).toBeDefined();
      expect(lossMovement.direction).toBe('OUT');
      expect(lossMovement.stock_location_id).toBe(inTransitId);
      expect(lossMovement.quantity_scaled).toBe(2000);

      // Receipts log contains 2 distinct audited delivery receipts
      const fullTransfer = transferService.getTransferById(transfer.id);
      expect(fullTransfer?.receipts?.length).toBe(2);
    });
  });

  // =========================================================================
  // 6. STATE TRANSITIONS, CANCELLATION & IMMUTABILITY
  // =========================================================================
  describe('6. State Transitions, Cancellation & Immutability', () => {
    it('cancels a requested transfer and marks status cancelled', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SOAP-BAR-100G',
        name: 'Hand Soap 100g',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 30000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 10000 }],
          autoSubmit: true
        },
        managerActor
      );

      const cancelled = transferService.cancelTransfer(
        transfer.id,
        'Duplicate order placed by mistake',
        ownerActor
      );

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.notes).toContain('Duplicate order placed by mistake');
    });

    it('prohibits cancelling a transfer once it has been dispatched', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'SHAMPOO-200ML',
        name: 'Daily Shampoo 200ml',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 40000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 10000 }],
          autoSubmit: true
        },
        managerActor
      );

      transferService.approveTransfer(transfer.id, ownerActor);
      transferService.dispatchTransfer({ transferId: transfer.id }, managerActor);

      expect(() => {
        transferService.cancelTransfer(transfer.id, 'Truck broke down', managerActor);
      }).toThrowError(InvalidTransferStateError);
    });

    it('enforces strict immutability once a transfer is fully received', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'WATER-BOTTLE-500ML',
        name: 'Mineral Water 500ml',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 50000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 20000 }],
          autoSubmit: true
        },
        managerActor
      );

      transferService.approveTransfer(transfer.id, ownerActor);
      const dispatched = transferService.dispatchTransfer({ transferId: transfer.id }, managerActor);
      const lineId = dispatched.lines![0].id;

      transferService.receiveTransfer(
        {
          transferId: transfer.id,
          lines: [{ lineId, receivedQuantityScaled: 20000 }]
        },
        managerActor
      );

      // Attempting to receive again throws TransferImmutabilityError
      expect(() => {
        transferService.receiveTransfer(
          {
            transferId: transfer.id,
            lines: [{ lineId, receivedQuantityScaled: 5000 }]
          },
          managerActor
        );
      }).toThrowError(TransferImmutabilityError);
    });

    it('prevents cashiers from approving stock transfers', () => {
      const prod = catalogService.createProduct({
        businessId,
        sku: 'TOOTHPASTE-100G',
        name: 'Herbal Toothpaste',
        baseUnitId: unitPieceId
      });

      setStock(prod.id, locStoreroomBranch1, 20000);

      const transfer = transferService.createTransfer(
        {
          businessId,
          sourceLocationId: locStoreroomBranch1,
          destinationLocationId: locShopFloorBranch1,
          lines: [{ productId: prod.id, requestedQuantityScaled: 5000 }],
          autoSubmit: true
        },
        managerActor
      );

      expect(() => {
        transferService.approveTransfer(transfer.id, cashierActor);
      }).toThrowError(/not permitted to approve/i);
    });
  });
});
