import Database from 'better-sqlite3';
import {
  StockLocation,
  CreateStockLocationDto,
  UpdateStockLocationDto,
  LegacyStockTransfer as StockTransfer,
  LegacyStockTransferLine as StockTransferLine,
  CreateStockTransferDto,
  LocationStockFilter,
  EnterpriseStockBalance
} from '../../shared/types/stock-location';
import {
  StockLocationRules,
  LocationHierarchyNode,
  CrossBusinessLocationError,
  LocationNotReceivableError,
  LocationNotSellableError,
  LocationInactiveError,
  CrossBranchTransferMismatchError
} from '../../domain/inventory/stock-location-rules';
import { StockLocationRepository } from '../../infrastructure/sqlite/repositories/StockLocationRepository';
import { StockBalanceRepository } from '../../infrastructure/sqlite/repositories/StockBalanceRepository';

export interface LocationActorContext {
  userId?: string | number;
  role?: string;
  businessId: string;
}

export class StockLocationService {
  private locationRepo: StockLocationRepository;
  private balanceRepo: StockBalanceRepository;

  constructor(private db: Database.Database) {
    this.locationRepo = new StockLocationRepository(db);
    this.balanceRepo = new StockBalanceRepository(db);
  }

  public getLocations(
    businessId: string,
    branchId?: string,
    includeInactive = false
  ): StockLocation[] {
    return this.locationRepo.findAll(businessId, branchId, includeInactive);
  }

  public getLocationById(id: string, businessId: string): StockLocation {
    const loc = this.locationRepo.findById(id, businessId);
    if (!loc) {
      throw new Error(`Stock location "${id}" not found.`);
    }
    return loc;
  }

  public createLocation(
    dto: CreateStockLocationDto,
    actor: LocationActorContext
  ): StockLocation {
    // 1. Business isolation
    if (dto.businessId !== actor.businessId) {
      throw new CrossBusinessLocationError('Cannot create location for another business.');
    }

    // 2. Validate branch exists and belongs to business
    const branch = this.db
      .prepare('SELECT id, business_id FROM branches WHERE id = ?')
      .get(dto.branchId) as { id: string; business_id: string } | undefined;
    if (!branch || branch.business_id !== dto.businessId) {
      throw new CrossBusinessLocationError('Branch does not belong to the current business.');
    }

    // 3. Hierarchy validation
    if (dto.parentLocationId) {
      StockLocationRules.validateHierarchy(
        null,
        dto.parentLocationId,
        (pId) => {
          const row = this.db
            .prepare(
              'SELECT id, business_id, branch_id, parent_location_id FROM stock_locations WHERE id = ?'
            )
            .get(pId) as any;
          return row
            ? {
                id: row.id,
                businessId: row.business_id,
                branchId: row.branch_id,
                parentLocationId: row.parent_location_id
              }
            : null;
        },
        dto.branchId,
        dto.businessId
      );
    }

    // 4. Create in repository
    const created = this.locationRepo.create(dto, actor.userId ? String(actor.userId) : null);

    // 5. Audit log
    this.logAudit({
      businessId: dto.businessId,
      branchId: dto.branchId,
      userId: actor.userId ? String(actor.userId) : null,
      action: 'STOCK_LOCATION_CREATED',
      entityId: created.id,
      details: { code: created.code, name: created.name, locationType: created.locationType }
    });

    return created;
  }

  public updateLocation(
    id: string,
    dto: UpdateStockLocationDto,
    actor: LocationActorContext
  ): StockLocation {
    const current = this.getLocationById(id, actor.businessId);

    // Hierarchy validation if updating parent
    if (dto.parentLocationId !== undefined && dto.parentLocationId !== current.parentLocationId) {
      StockLocationRules.validateHierarchy(
        id,
        dto.parentLocationId,
        (pId) => {
          const row = this.db
            .prepare(
              'SELECT id, business_id, branch_id, parent_location_id FROM stock_locations WHERE id = ?'
            )
            .get(pId) as any;
          return row
            ? {
                id: row.id,
                businessId: row.business_id,
                branchId: row.branch_id,
                parentLocationId: row.parent_location_id
              }
            : null;
        },
        current.branchId,
        actor.businessId
      );
    }

    const updated = this.locationRepo.update(id, dto, actor.businessId);

    this.logAudit({
      businessId: actor.businessId,
      branchId: updated.branchId,
      userId: actor.userId ? String(actor.userId) : null,
      action: 'STOCK_LOCATION_UPDATED',
      entityId: updated.id,
      details: { code: updated.code, name: updated.name, changes: dto }
    });

    return updated;
  }

  public archiveLocation(id: string, actor: LocationActorContext): void {
    const loc = this.getLocationById(id, actor.businessId);

    // Calculate total on hand and total reserved across all products for this location
    const totals = this.db
      .prepare(
        `SELECT COALESCE(SUM(on_hand_scaled), 0) AS total_on_hand,
                COALESCE(SUM(reserved_scaled), 0) AS total_reserved
         FROM stock_balances
         WHERE stock_location_id = ? AND business_id = ?`
      )
      .get(id, actor.businessId) as { total_on_hand: number; total_reserved: number };

    // Rules 3 & 4: Archival validation
    StockLocationRules.validateArchival(
      Number(totals?.total_on_hand || 0),
      Number(totals?.total_reserved || 0)
    );

    // Rule 14: If default location, require another default first
    if (loc.isDefault) {
      const other = this.db
        .prepare(
          'SELECT id FROM stock_locations WHERE branch_id = ? AND is_default = 1 AND is_active = 1 AND id != ?'
        )
        .get(loc.branchId, id);
      if (!other) {
        throw new Error(
          'Cannot archive the default location for this branch. Designate another default location first.'
        );
      }
    }

    this.locationRepo.update(id, { isActive: false }, actor.businessId);

    this.logAudit({
      businessId: actor.businessId,
      branchId: loc.branchId,
      userId: actor.userId ? String(actor.userId) : null,
      action: 'STOCK_LOCATION_ARCHIVED',
      entityId: id,
      details: { code: loc.code, name: loc.name }
    });
  }

  /**
   * Executes an atomic stock transfer. Supports internal transfers (within same branch)
   * and explicit branch transfers (between different branches).
   * Creates paired stock movements (TRANSFER_OUT / TRANSFER_IN).
   */
  public transferStock(
    dto: CreateStockTransferDto,
    actor: LocationActorContext
  ): StockTransfer {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('Stock transfer must contain at least one item.');
    }

    const sourceLoc = this.getLocationById(dto.sourceLocationId, actor.businessId);
    const destLoc = this.getLocationById(dto.destinationLocationId, actor.businessId);

    const isInternal = sourceLoc.branchId === destLoc.branchId;

    // Rule 10: Disguising inter-branch transfers as internal transfers is strictly rejected
    if (!isInternal && (dto as any).transferType !== 'BRANCH_TRANSFER') {
      throw new CrossBranchTransferMismatchError();
    }

    const transferType = isInternal ? 'INTERNAL_LOCATION' : 'BRANCH_TRANSFER';

    // Validation
    if (isInternal) {
      StockLocationRules.validateInternalTransfer(sourceLoc, destLoc, 1);
    } else {
      StockLocationRules.validateReceivable(destLoc);
      if (!sourceLoc.isActive) {
        throw new LocationInactiveError(`Source location "${sourceLoc.name}" is inactive.`);
      }
    }

    const transferId = crypto.randomUUID();
    const transferNumber = `TRF-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const tx = this.db.transaction(() => {
      // Insert transfer header
      this.db
        .prepare(
          `INSERT INTO stock_transfers (
            id, business_id, transfer_number, transfer_type,
            source_branch_id, destination_branch_id,
            source_location_id, destination_location_id,
            status, notes, created_by, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')), (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')))`
        )
        .run(
          transferId,
          actor.businessId,
          transferNumber,
          transferType,
          sourceLoc.branchId,
          destLoc.branchId,
          sourceLoc.id,
          destLoc.id,
          dto.notes || null,
          actor.userId ? String(actor.userId) : null
        );

      const insertLine = this.db.prepare(
        `INSERT INTO stock_transfer_lines (
          id, transfer_id, product_id, variant_id, quantity_scaled, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );

      const insertMovement = this.db.prepare(
        `INSERT INTO stock_movements (
          product_id, variant_id, location_id, stock_location_id, transfer_id,
          movement_type, quantity, quantity_base_scaled, previous_stock, new_stock,
          reference_type, reference_id, source_type, source_id, reason, user_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, 'STOCK_TRANSFER', ?, ?, ?)`
      );

      for (const item of dto.items) {
        if (item.quantityScaled <= 0) {
          throw new Error('Transfer quantity must be strictly greater than zero.');
        }

        const pId = String(item.productId);
        const vId = item.variantId ? String(item.variantId) : null;

        // Check source stock
        const sourceBal = this.balanceRepo.getBalance(pId, sourceLoc.id, actor.businessId, vId);
        const currentSourceOnHand = sourceBal ? sourceBal.onHandScaled : 0;
        const currentSourceAvailable = sourceBal ? sourceBal.availableScaled : 0;

        if (currentSourceAvailable < item.quantityScaled) {
          throw new Error(
            `Insufficient available stock in "${sourceLoc.name}" for product ID ${pId}. Available: ${currentSourceAvailable}, Requested: ${item.quantityScaled}.`
          );
        }

        // Insert transfer line
        const lineId = crypto.randomUUID();
        insertLine.run(lineId, transferId, pId, vId, item.quantityScaled, item.notes || null);

        // Update Source Balance (decrement on_hand_scaled)
        const updatedSourceBal = this.balanceRepo.upsertDelta({
          businessId: actor.businessId,
          productId: pId,
          variantId: vId,
          stockLocationId: sourceLoc.id,
          onHandDeltaScaled: -item.quantityScaled
        });

        // Update Destination Balance (increment on_hand_scaled)
        const destBal = this.balanceRepo.getBalance(pId, destLoc.id, actor.businessId, vId);
        const prevDestOnHand = destBal ? destBal.onHandScaled : 0;

        const updatedDestBal = this.balanceRepo.upsertDelta({
          businessId: actor.businessId,
          productId: pId,
          variantId: vId,
          stockLocationId: destLoc.id,
          onHandDeltaScaled: item.quantityScaled
        });

        const qtyFloat = item.quantityScaled / 1000;

        // Paired Stock Movements:
        // 1. TRANSFER_OUT at source location
        insertMovement.run(
          pId,
          vId,
          sourceLoc.id,
          transferId,
          'TRANSFER_OUT',
          -qtyFloat,
          -item.quantityScaled,
          currentSourceOnHand / 1000,
          updatedSourceBal.onHandScaled / 1000,
          transferNumber,
          transferNumber,
          `Stock transfer to ${destLoc.name}`,
          actor.userId ? Number(actor.userId) || 1 : 1
        );

        // 2. TRANSFER_IN at destination location
        insertMovement.run(
          pId,
          vId,
          destLoc.id,
          transferId,
          'TRANSFER_IN',
          qtyFloat,
          item.quantityScaled,
          prevDestOnHand / 1000,
          updatedDestBal.onHandScaled / 1000,
          transferNumber,
          transferNumber,
          `Stock transfer from ${sourceLoc.name}`,
          actor.userId ? Number(actor.userId) || 1 : 1
        );
      }
    });

    tx();

    return {
      id: transferId,
      businessId: actor.businessId,
      transferNumber,
      transferType,
      sourceBranchId: sourceLoc.branchId,
      destinationBranchId: destLoc.branchId,
      sourceLocationId: sourceLoc.id,
      destinationLocationId: destLoc.id,
      status: 'COMPLETED',
      notes: dto.notes,
      createdAt: new Date().toISOString(),
      sourceLocationName: sourceLoc.name,
      destinationLocationName: destLoc.name
    };
  }

  public getLocationStock(
    locationId: string,
    businessId: string,
    filter?: LocationStockFilter
  ): EnterpriseStockBalance[] {
    return this.balanceRepo.getLocationBalances(locationId, businessId, filter);
  }

  public getProductStockByLocations(
    productId: string | number,
    businessId: string
  ): EnterpriseStockBalance[] {
    return this.balanceRepo.getProductBalances(productId, businessId);
  }

  public getLocationMovements(
    locationId: string,
    businessId: string,
    limit = 100
  ): any[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, p.name AS product_name, p.sku AS product_sku
         FROM stock_movements m
         JOIN products p ON m.product_id = p.id
         WHERE (m.stock_location_id = ? OR (m.stock_location_id IS NULL AND m.location_id = 1))
           AND p.business_id = ?
         ORDER BY m.id DESC LIMIT ?`
      )
      .all(locationId, businessId, limit);

    return rows;
  }

  public getDefaultLocationForSale(
    branchId: string,
    counterId?: string,
    businessId?: string
  ): StockLocation {
    const bizId = businessId || '00000000-0000-0000-0000-000000000001';

    if (counterId) {
      const counterLoc = this.locationRepo.getCounterDefaultLocation(counterId, bizId);
      if (counterLoc && counterLoc.isActive && counterLoc.isSellable) {
        return counterLoc;
      }
    }

    const defaultLoc = this.locationRepo.getDefaultLocation(branchId, bizId);
    if (!defaultLoc) {
      throw new Error(`No active default stock location found for branch "${branchId}".`);
    }

    StockLocationRules.validateSellable(defaultLoc);
    return defaultLoc;
  }

  private logAudit(entry: {
    businessId: string;
    branchId?: string;
    userId?: string | null;
    action: string;
    entityId: string;
    details: any;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, business_id, branch_id, user_id, action, entity_type, entity_id, after_data
          ) VALUES (?, ?, ?, ?, ?, 'stock_location', ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          entry.businessId,
          entry.branchId || null,
          entry.userId || null,
          entry.action,
          entry.entityId,
          JSON.stringify(entry.details)
        );
    } catch {
      // Audit non-fatal fallback
    }
  }
}
