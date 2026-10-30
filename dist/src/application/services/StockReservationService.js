"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockReservationService = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("../../infrastructure/sqlite/connection");
const StockReservationRepository_1 = require("../../infrastructure/sqlite/repositories/StockReservationRepository");
const StockBalanceRepository_1 = require("../../infrastructure/sqlite/repositories/StockBalanceRepository");
const ProductRepository_1 = require("../../infrastructure/sqlite/repositories/ProductRepository");
const StockLocationRepository_1 = require("../../infrastructure/sqlite/repositories/StockLocationRepository");
const stock_reservation_rules_1 = require("../../domain/inventory/stock-reservation-rules");
const stock_location_rules_1 = require("../../domain/inventory/stock-location-rules");
const BatchRepository_1 = require("../../infrastructure/sqlite/repositories/BatchRepository");
const batch_expiry_rules_1 = require("../../domain/inventory/batch-expiry-rules");
class StockReservationService {
    db;
    reservationRepo;
    balanceRepo;
    productRepo;
    locationRepo;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
        this.reservationRepo = new StockReservationRepository_1.StockReservationRepository(this.db);
        this.balanceRepo = new StockBalanceRepository_1.StockBalanceRepository(this.db);
        this.productRepo = new ProductRepository_1.ProductRepository(this.db);
        this.locationRepo = new StockLocationRepository_1.StockLocationRepository(this.db);
    }
    /**
     * Generates sequential human-readable reservation number: RES-YYYYMMDD-XXXX
     */
    generateReservationNumber(businessId) {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const prefix = `RES-${today}-`;
        const row = this.db.prepare(`
      SELECT reservation_number FROM stock_reservations
      WHERE business_id = ? AND reservation_number LIKE ?
      ORDER BY reservation_number DESC LIMIT 1
    `).get(businessId, `${prefix}%`);
        let nextSeq = 1;
        if (row) {
            const parts = row.reservation_number.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq))
                nextSeq = seq + 1;
        }
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }
    /**
     * Creates an active stock reservation, validating available stock and immediately
     * committing inventory in stock_balances within the same database transaction.
     */
    createReservation(dto, actor) {
        if (!dto.lines || dto.lines.length === 0) {
            throw new Error('Reservation must include at least one product line.');
        }
        // Step 1: Proactively sweep expired reservations to keep availability accurate
        this.checkAndExpireReservations(dto.businessId);
        const now = new Date().toISOString();
        const reservationId = (0, crypto_1.randomUUID)();
        const reservationNumber = this.generateReservationNumber(dto.businessId);
        // Step 2: Validate branch & locations
        const branch = this.db.prepare('SELECT id, business_id FROM branches WHERE id = ?').get(dto.branchId);
        if (!branch) {
            throw new Error(`Branch '${dto.branchId}' not found.`);
        }
        if (branch.business_id !== dto.businessId) {
            throw new stock_reservation_rules_1.CrossBranchReservationError(dto.businessId, branch.business_id);
        }
        const linesToCreate = [];
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
                throw new stock_reservation_rules_1.CrossBranchReservationError(dto.branchId, location.branchId);
            }
            stock_location_rules_1.StockLocationRules.validateSellable({
                name: location.name,
                isActive: location.isActive,
                isSellable: location.isSellable,
                locationType: location.locationType
            });
            const balance = this.balanceRepo.getBalance(item.productId, item.stockLocationId, dto.businessId, item.variantId);
            const onHandScaled = balance ? balance.onHandScaled : 0;
            const reservedScaled = balance ? balance.reservedScaled : 0;
            const availableScaled = stock_reservation_rules_1.StockReservationRules.calculateAvailableStock(onHandScaled, reservedScaled);
            // Validate batch availability if reservation is batch-specific
            if (item.batchId) {
                const batchBal = this.db.prepare(`
          SELECT on_hand_scaled, reserved_scaled FROM batch_stock_balances
          WHERE business_id = ? AND batch_id = ? AND stock_location_id = ?
        `).get(dto.businessId, item.batchId, item.stockLocationId);
                if (batchBal) {
                    const bAvail = (Number(batchBal.on_hand_scaled) || 0) - (Number(batchBal.reserved_scaled) || 0);
                    if (bAvail < item.reservedQuantityScaled) {
                        throw new batch_expiry_rules_1.InsufficientBatchStockError(String(item.batchId), item.reservedQuantityScaled / 1000, bAvail / 1000);
                    }
                }
            }
            stock_reservation_rules_1.StockReservationRules.validateAvailabilityForReservation(product.name, availableScaled, item.reservedQuantityScaled);
            linesToCreate.push({
                id: (0, crypto_1.randomUUID)(),
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
        const reservation = {
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
                        const batchRepo = new BatchRepository_1.BatchRepository(this.db);
                        batchRepo.upsertBalanceDelta({
                            businessId: dto.businessId,
                            batchId: String(line.batchId),
                            stockLocationId: line.stockLocationId,
                            onHandDeltaScaled: 0,
                            reservedDeltaScaled: line.reservedQuantityScaled
                        });
                    }
                    catch {
                        // Safe fallback
                    }
                }
            }
        });
        tx();
        return this.reservationRepo.findById(reservationId);
    }
    /**
     * Fulfills an active reservation (partially or completely) linked to a sale.
     * Releases fulfilled reservation commitment so available stock is preserved.
     */
    fulfillReservation(dto, actor) {
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
                stock_reservation_rules_1.StockReservationRules.validateFulfillment(reservation, line, fItem.fulfillQuantityScaled, now);
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
            const allFulfilled = lines.every((l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled);
            const newStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';
            this.reservationRepo.updateStatus(reservation.id, newStatus, { updatedAt: now });
        });
        tx();
        return this.reservationRepo.findById(dto.reservationId);
    }
    /**
     * Manually releases unfulfilled reservation commitment and restores available stock.
     */
    releaseReservation(dto, actor) {
        this.checkAndExpireReservations();
        const reservation = this.reservationRepo.findById(dto.reservationId);
        if (!reservation) {
            throw new Error(`Reservation '${dto.reservationId}' not found.`);
        }
        if (reservation.status === 'cancelled') {
            throw new stock_reservation_rules_1.ReservationCancelledError(reservation.reservationNumber);
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
            const allDone = lines.every((l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled);
            const anyFulfilled = lines.some((l) => l.fulfilledQuantityScaled > 0);
            let newStatus = reservation.status;
            if (allDone) {
                newStatus = anyFulfilled ? 'fulfilled' : 'cancelled';
            }
            this.reservationRepo.updateStatus(reservation.id, newStatus, { updatedAt: now });
        });
        tx();
        return this.reservationRepo.findById(dto.reservationId);
    }
    /**
     * Cancels a reservation completely, releasing all unfulfilled quantities.
     */
    cancelReservation(reservationId, actor, reason) {
        return this.releaseReservation({ reservationId, reason }, actor);
    }
    /**
     * Extends the expiration date of an active or expired reservation.
     * If extending an expired reservation, re-validates stock and re-commits reserved quantities.
     */
    extendReservation(dto, actor) {
        const reservation = this.reservationRepo.findById(dto.reservationId);
        if (!reservation) {
            throw new Error(`Reservation '${dto.reservationId}' not found.`);
        }
        const now = new Date().toISOString();
        stock_reservation_rules_1.StockReservationRules.validateCanExtend(reservation, dto.newExpiresAt, now);
        const tx = this.db.transaction(() => {
            // If extending an already-expired reservation, re-commit the unfulfilled quantities
            if (reservation.status === 'expired') {
                const lines = reservation.lines || [];
                for (const line of lines) {
                    const unfulfilled = line.reservedQuantityScaled - line.fulfilledQuantityScaled - line.releasedQuantityScaled;
                    if (unfulfilled > 0) {
                        const product = this.productRepo.findById(line.productId);
                        const balance = this.balanceRepo.getBalance(line.productId, line.stockLocationId, reservation.businessId, line.variantId);
                        const onHand = balance ? balance.onHandScaled : 0;
                        const reserved = balance ? balance.reservedScaled : 0;
                        const available = stock_reservation_rules_1.StockReservationRules.calculateAvailableStock(onHand, reserved);
                        stock_reservation_rules_1.StockReservationRules.validateAvailabilityForReservation(product?.name || String(line.productId), available, unfulfilled);
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
                const restoredStatus = anyFulfilled ? 'partially_fulfilled' : 'active';
                this.reservationRepo.updateStatus(reservation.id, restoredStatus, {
                    expiresAt: dto.newExpiresAt,
                    updatedAt: now
                });
            }
            else {
                this.reservationRepo.updateExpiration(reservation.id, dto.newExpiresAt);
            }
        });
        tx();
        return this.reservationRepo.findById(dto.reservationId);
    }
    /**
     * Proactive expiration sweep:
     * Recalculates and expires reservations whose expires_at is past now.
     * Releases unfulfilled quantities immediately.
     * Does NOT rely exclusively on background timer.
     */
    checkAndExpireReservations(businessId, now = new Date().toISOString()) {
        const expiredList = this.reservationRepo.findExpiredActiveReservations(businessId, now);
        if (expiredList.length === 0)
            return [];
        const processed = [];
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
                processed.push(this.reservationRepo.findById(res.id));
            }
        });
        tx();
        return processed;
    }
    /**
     * Retrieves reservation by ID, running expiration check first.
     */
    getReservation(id) {
        this.checkAndExpireReservations();
        return this.reservationRepo.findById(id);
    }
    /**
     * Retrieves reservation by number, running expiration check first.
     */
    getReservationByNumber(reservationNumber) {
        this.checkAndExpireReservations();
        return this.reservationRepo.findByReservationNumber(reservationNumber);
    }
    /**
     * Lists reservations matching filter, running expiration check first.
     */
    listReservations(filter) {
        this.checkAndExpireReservations(filter.businessId);
        return this.reservationRepo.list(filter);
    }
    /**
     * Audits and reconciles stock_balances reserved_scaled against actual active reservations.
     */
    reconcileStockBalances(businessId, productId, stockLocationId, variantId) {
        const activeReserved = this.reservationRepo.getActiveReservedQuantity(productId, stockLocationId, businessId, variantId);
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
exports.StockReservationService = StockReservationService;
