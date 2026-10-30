import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../../infrastructure/sqlite/connection';
import { StockReservationRepository } from '../../infrastructure/sqlite/repositories/StockReservationRepository';
import { StockBalanceRepository } from '../../infrastructure/sqlite/repositories/StockBalanceRepository';
import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { StockLocationRepository } from '../../infrastructure/sqlite/repositories/StockLocationRepository';
import {
  StockReservation,
  StockReservationLine,
  StockReservationStatus,
  CreateReservationDto,
  FulfillReservationDto,
  ReleaseReservationDto,
  ExtendReservationDto,
  ReservationFilter
} from '../../shared/types/stock-reservation';
import {
  StockReservationRules,
  ReservationUnavailableStockError,
  ReservationCancelledError,
  ReservationExpiredError,
  CrossBranchReservationError
} from '../../domain/inventory/stock-reservation-rules';
import { StockLocationRules } from '../../domain/inventory/stock-location-rules';
import { BatchRepository } from '../../infrastructure/sqlite/repositories/BatchRepository';
import { InsufficientBatchStockError } from '../../domain/inventory/batch-expiry-rules';

export interface ActorContext {
  userId: string | number;
  role?: string;
  businessId?: string;
}

export class StockReservationService {
  private reservationRepo: StockReservationRepository;
  private balanceRepo: StockBalanceRepository;
  private productRepo: ProductRepository;
  private locationRepo: StockLocationRepository;

  constructor(private db: Database.Database = getDatabase()) {
    this.reservationRepo = new StockReservationRepository(this.db);
    this.balanceRepo = new StockBalanceRepository(this.db);
    this.productRepo = new ProductRepository(this.db);
    this.locationRepo = new StockLocationRepository(this.db);
  }

  /**
   * Generates sequential human-readable reservation number: RES-YYYYMMDD-XXXX
   */
  private generateReservationNumber(businessId: string): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `RES-${today}-`;

    const row = this.db.prepare(`
      SELECT reservation_number FROM stock_reservations
      WHERE business_id = ? AND reservation_number LIKE ?
      ORDER BY reservation_number DESC LIMIT 1
    `).get(businessId, `${prefix}%`) as { reservation_number: string } | undefined;

    let nextSeq = 1;
    if (row) {
      const parts = row.reservation_number.split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq)) nextSeq = seq + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Creates an active stock reservation, validating available stock and immediately
   * committing inventory in stock_balances within the same database transaction.
   */
  public createReservation(dto: CreateReservationDto, actor: ActorContext): StockReservation {
    if (!dto.lines || dto.lines.length === 0) {
      throw new Error('Reservation must include at least one product line.');
    }

    // Step 1: Proactively sweep expired reservations to keep availability accurate
    this.checkAndExpireReservations(dto.businessId);

    const now = new Date().toISOString();
    const reservationId = randomUUID();
    const reservationNumber = this.generateReservationNumber(dto.businessId);

    // Step 2: Validate branch & locations
    const branch = this.db.prepare('SELECT id, business_id FROM branches WHERE id = ?').get(dto.branchId) as any;
    if (!branch) {
      throw new Error(`Branch '${dto.branchId}' not found.`);
    }
    if (branch.business_id !== dto.businessId) {
      throw new CrossBranchReservationError(dto.businessId, branch.business_id);
    }

    const linesToCreate: StockReservationLine[] = [];

    // Step 3: Validate available stock for each requested line
    for (const item of dto.lines) {
      const product = this.productRepo.findById(item.productId);
      if (!product || !product.isActive) {
        throw new Error(`Product '${item.productId}' not found or inactive.`);
      }

      const location = this.locationRepo.findById(item.stockLocationId);
      if (!location || !location.isActive) {
        throw new Error(`Stock location '${item.stockLocationId}' not found or inactive.`);
      }

      if (location.branchId !== dto.branchId) {
        throw new CrossBranchReservationError(dto.branchId, location.branchId);
      }

      StockLocationRules.validateSellable({
        name: location.name,
        isActive: location.isActive,
        isSellable: location.isSellable,
        locationType: location.locationType
      });

      const balance = this.balanceRepo.getBalance(
        item.productId,
        item.stockLocationId,
        dto.businessId,
        item.variantId
      );

      const onHandScaled = balance ? balance.onHandScaled : 0;
      const reservedScaled = balance ? balance.reservedScaled : 0;
      const availableScaled = StockReservationRules.calculateAvailableStock(onHandScaled, reservedScaled);

      // Validate batch availability if reservation is batch-specific
      if (item.batchId) {
        const batchBal = this.db.prepare(`
          SELECT on_hand_scaled, reserved_scaled FROM batch_stock_balances
          WHERE business_id = ? AND batch_id = ? AND stock_location_id = ?
        `).get(dto.businessId, item.batchId, item.stockLocationId) as any;
        if (batchBal) {
          const bAvail = (Number(batchBal.on_hand_scaled) || 0) - (Number(batchBal.reserved_scaled) || 0);
          if (bAvail < item.reservedQuantityScaled) {
            throw new InsufficientBatchStockError(
              String(item.batchId),
              item.reservedQuantityScaled / 1000,
              bAvail / 1000
            );
          }
        }
      }

      StockReservationRules.validateAvailabilityForReservation(
        product.name,
        availableScaled,
        item.reservedQuantityScaled
      );

      linesToCreate.push({
        id: randomUUID(),
        reservationId,
        productId: item.productId,
        variantId: item.variantId,
        stockLocationId: item.stockLocationId,
        batchId: item.batchId,
        reservedQuantityScaled: item.reservedQuantityScaled,
        fulfilledQuantityScaled: 0,
        releasedQuantityScaled: 0,
        unitId: item.unitId || product.baseUnitId
      });
    }

    // Step 4: Atomic insertion & stock_balances commitment
    const reservation: StockReservation = {
      id: reservationId,
      businessId: dto.businessId,
      branchId: dto.branchId,
      reservationNumber,
      customerId: dto.customerId || null,
      sourceType: dto.sourceType,
      sourceId: dto.sourceId || null,
      status: 'active',
      reservedAt: now,
      expiresAt: dto.expiresAt || null,
      createdBy: String(actor.userId),
      createdAt: now,
      updatedAt: now
    };

    const tx = this.db.transaction(() => {
      this.reservationRepo.create(reservation, linesToCreate);

      // Immediately commit reserved quantities into stock_balances and batch_stock_balances
      for (const line of linesToCreate) {
        this.balanceRepo.upsertDelta({
          businessId: dto.businessId,
          productId: line.productId,
          variantId: line.variantId,
          stockLocationId: line.stockLocationId,
          onHandDeltaScaled: 0,
          reservedDeltaScaled: line.reservedQuantityScaled
        });

        if (line.batchId) {
          try {
            const batchRepo = new BatchRepository(this.db);
            batchRepo.upsertBalanceDelta({
              businessId: dto.businessId,
              batchId: String(line.batchId),
              stockLocationId: line.stockLocationId,
              onHandDeltaScaled: 0,
              reservedDeltaScaled: line.reservedQuantityScaled
            });
          } catch {
            // Safe fallback
          }
        }
      }
    });

    tx();
    return this.reservationRepo.findById(reservationId)!;
  }

  /**
   * Fulfills an active reservation (partially or completely) linked to a sale.
   * Releases fulfilled reservation commitment so available stock is preserved.
   */
  public fulfillReservation(dto: FulfillReservationDto, actor: ActorContext): StockReservation {
    this.checkAndExpireReservations();

    const reservation = this.reservationRepo.findById(dto.reservationId);
    if (!reservation) {
      throw new Error(`Reservation '${dto.reservationId}' not found.`);
    }

    const now = new Date().toISOString();
    const lines = reservation.lines || [];

    const tx = this.db.transaction(() => {
      for (const fItem of dto.lines) {
        const line = lines.find((l) => l.id === fItem.lineId);
        if (!line) {
          throw new Error(`Reservation line '${fItem.lineId}' not found in reservation '${reservation.reservationNumber}'.`);
        }

        StockReservationRules.validateFulfillment(reservation, line, fItem.fulfillQuantityScaled, now);

        // Update line fulfillment
        this.reservationRepo.updateLineQuantities(line.id, fItem.fulfillQuantityScaled, 0);

        // Deduct from stock_balances reserved amount (relieves reservation commitment)
        this.balanceRepo.upsertDelta({
          businessId: reservation.businessId,
          productId: line.productId,
          variantId: line.variantId,
          stockLocationId: line.stockLocationId,
          onHandDeltaScaled: 0,
          reservedDeltaScaled: -fItem.fulfillQuantityScaled
        });

        // Mutate local state for status evaluation
        line.fulfilledQuantityScaled += fItem.fulfillQuantityScaled;
      }

      // Check if completely fulfilled
      const allFulfilled = lines.every(
        (l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled
      );
      const newStatus: StockReservationStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';

      this.reservationRepo.updateStatus(reservation.id, newStatus, { updatedAt: now });
    });

    tx();
    return this.reservationRepo.findById(dto.reservationId)!;
  }

  /**
   * Manually releases unfulfilled reservation commitment and restores available stock.
   */
  public releaseReservation(dto: ReleaseReservationDto, actor: ActorContext): StockReservation {
    this.checkAndExpireReservations();

    const reservation = this.reservationRepo.findById(dto.reservationId);
    if (!reservation) {
      throw new Error(`Reservation '${dto.reservationId}' not found.`);
    }

    if (reservation.status === 'cancelled') {
      throw new ReservationCancelledError(reservation.reservationNumber);
    }

    const now = new Date().toISOString();
    const lines = reservation.lines || [];

    const tx = this.db.transaction(() => {
      for (const line of lines) {
        if (dto.lineIds && !dto.lineIds.includes(line.id)) {
          continue;
        }

        const unfulfilled = line.reservedQuantityScaled - line.fulfilledQuantityScaled - line.releasedQuantityScaled;
        if (unfulfilled > 0) {
          this.reservationRepo.updateLineQuantities(line.id, 0, unfulfilled);

          // Restore available stock by decrementing reserved_scaled
          this.balanceRepo.upsertDelta({
            businessId: reservation.businessId,
            productId: line.productId,
            variantId: line.variantId,
            stockLocationId: line.stockLocationId,
            onHandDeltaScaled: 0,
            reservedDeltaScaled: -unfulfilled
          });

          line.releasedQuantityScaled += unfulfilled;
        }
      }

      const allDone = lines.every(
        (l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled
      );
      const anyFulfilled = lines.some((l) => l.fulfilledQuantityScaled > 0);

      let newStatus: StockReservationStatus = reservation.status;
      if (allDone) {
        newStatus = anyFulfilled ? 'fulfilled' : 'cancelled';
      }

      this.reservationRepo.updateStatus(reservation.id, newStatus, { updatedAt: now });
    });

    tx();
    return this.reservationRepo.findById(dto.reservationId)!;
  }

  /**
   * Cancels a reservation completely, releasing all unfulfilled quantities.
   */
  public cancelReservation(reservationId: string, actor: ActorContext, reason?: string): StockReservation {
    return this.releaseReservation({ reservationId, reason }, actor);
  }

  /**
   * Extends the expiration date of an active or expired reservation.
   * If extending an expired reservation, re-validates stock and re-commits reserved quantities.
   */
  public extendReservation(dto: ExtendReservationDto, actor: ActorContext): StockReservation {
    const reservation = this.reservationRepo.findById(dto.reservationId);
    if (!reservation) {
      throw new Error(`Reservation '${dto.reservationId}' not found.`);
    }

    const now = new Date().toISOString();
    StockReservationRules.validateCanExtend(reservation, dto.newExpiresAt, now);

    const tx = this.db.transaction(() => {
      // If extending an already-expired reservation, re-commit the unfulfilled quantities
      if (reservation.status === 'expired') {
        const lines = reservation.lines || [];
        for (const line of lines) {
          const unfulfilled = line.reservedQuantityScaled - line.fulfilledQuantityScaled - line.releasedQuantityScaled;
          if (unfulfilled > 0) {
            const product = this.productRepo.findById(line.productId);
            const balance = this.balanceRepo.getBalance(
              line.productId,
              line.stockLocationId,
              reservation.businessId,
              line.variantId
            );
            const onHand = balance ? balance.onHandScaled : 0;
            const reserved = balance ? balance.reservedScaled : 0;
            const available = StockReservationRules.calculateAvailableStock(onHand, reserved);

            StockReservationRules.validateAvailabilityForReservation(
              product?.name || String(line.productId),
              available,
              unfulfilled
            );

            this.balanceRepo.upsertDelta({
              businessId: reservation.businessId,
              productId: line.productId,
              variantId: line.variantId,
              stockLocationId: line.stockLocationId,
              onHandDeltaScaled: 0,
              reservedDeltaScaled: unfulfilled
            });
          }
        }

        const anyFulfilled = lines.some((l) => l.fulfilledQuantityScaled > 0);
        const restoredStatus: StockReservationStatus = anyFulfilled ? 'partially_fulfilled' : 'active';
        this.reservationRepo.updateStatus(reservation.id, restoredStatus, {
          expiresAt: dto.newExpiresAt,
          updatedAt: now
        });
      } else {
        this.reservationRepo.updateExpiration(reservation.id, dto.newExpiresAt);
      }
    });

    tx();
    return this.reservationRepo.findById(dto.reservationId)!;
  }

  /**
   * Proactive expiration sweep:
   * Recalculates and expires reservations whose expires_at is past now.
   * Releases unfulfilled quantities immediately.
   * Does NOT rely exclusively on background timer.
   */
  public checkAndExpireReservations(
    businessId?: string,
    now: string = new Date().toISOString()
  ): StockReservation[] {
    const expiredList = this.reservationRepo.findExpiredActiveReservations(businessId, now);

    if (expiredList.length === 0) return [];

    const processed: StockReservation[] = [];

    const tx = this.db.transaction(() => {
      for (const res of expiredList) {
        const lines = res.lines || [];
        for (const line of lines) {
          const unfulfilled = line.reservedQuantityScaled - line.fulfilledQuantityScaled - line.releasedQuantityScaled;
          if (unfulfilled > 0) {
            // Release the committed reserved quantity
            this.balanceRepo.upsertDelta({
              businessId: res.businessId,
              productId: line.productId,
              variantId: line.variantId,
              stockLocationId: line.stockLocationId,
              onHandDeltaScaled: 0,
              reservedDeltaScaled: -unfulfilled
            });
          }
        }

        this.reservationRepo.updateStatus(res.id, 'expired', { updatedAt: now });
        processed.push(this.reservationRepo.findById(res.id)!);
      }
    });

    tx();
    return processed;
  }

  /**
   * Retrieves reservation by ID, running expiration check first.
   */
  public getReservation(id: string): StockReservation | null {
    this.checkAndExpireReservations();
    return this.reservationRepo.findById(id);
  }

  /**
   * Retrieves reservation by number, running expiration check first.
   */
  public getReservationByNumber(reservationNumber: string): StockReservation | null {
    this.checkAndExpireReservations();
    return this.reservationRepo.findByReservationNumber(reservationNumber);
  }

  /**
   * Lists reservations matching filter, running expiration check first.
   */
  public listReservations(filter: ReservationFilter): StockReservation[] {
    this.checkAndExpireReservations(filter.businessId);
    return this.reservationRepo.list(filter);
  }

  /**
   * Audits and reconciles stock_balances reserved_scaled against actual active reservations.
   */
  public reconcileStockBalances(
    businessId: string,
    productId: string | number,
    stockLocationId: string,
    variantId?: string | number | null
  ): { previousReservedScaled: number; reconciledReservedScaled: number } {
    const activeReserved = this.reservationRepo.getActiveReservedQuantity(
      productId,
      stockLocationId,
      businessId,
      variantId
    );

    const currentBal = this.balanceRepo.getBalance(productId, stockLocationId, businessId, variantId);
    const prevReserved = currentBal ? currentBal.reservedScaled : 0;

    if (prevReserved !== activeReserved) {
      this.balanceRepo.upsertDelta({
        businessId,
        productId,
        variantId,
        stockLocationId,
        onHandDeltaScaled: 0,
        reservedDeltaScaled: activeReserved - prevReserved
      });
    }

    return {
      previousReservedScaled: prevReserved,
      reconciledReservedScaled: activeReserved
    };
  }
}
