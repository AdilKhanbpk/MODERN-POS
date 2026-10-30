"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockReservationRules = exports.InsufficientAvailableStockError = exports.CrossBranchReservationError = exports.ReservationStockConflictError = exports.ReservationFulfilledError = exports.ReservationCancelledError = exports.ReservationExpiredError = exports.ReservationOverFulfilmentError = exports.ReservationUnavailableStockError = void 0;
class ReservationUnavailableStockError extends Error {
    constructor(productName, available, requested) {
        super(`Cannot reserve ${requested} units of "${productName}". Only ${available} units are currently available (remaining stock is committed to other reservations).`);
        this.name = 'ReservationUnavailableStockError';
    }
}
exports.ReservationUnavailableStockError = ReservationUnavailableStockError;
class ReservationOverFulfilmentError extends Error {
    constructor(lineId, remainingReserved, requestedFulfill) {
        super(`Cannot fulfill ${requestedFulfill} units for line ${lineId}. Remaining active reserved quantity is only ${remainingReserved} units.`);
        this.name = 'ReservationOverFulfilmentError';
    }
}
exports.ReservationOverFulfilmentError = ReservationOverFulfilmentError;
class ReservationExpiredError extends Error {
    constructor(reservationNumber, expiresAt) {
        super(`Reservation "${reservationNumber}" expired at ${expiresAt} and cannot be fulfilled without an authorized extension.`);
        this.name = 'ReservationExpiredError';
    }
}
exports.ReservationExpiredError = ReservationExpiredError;
class ReservationCancelledError extends Error {
    constructor(reservationNumber) {
        super(`Reservation "${reservationNumber}" has been cancelled and cannot be fulfilled or modified.`);
        this.name = 'ReservationCancelledError';
    }
}
exports.ReservationCancelledError = ReservationCancelledError;
class ReservationFulfilledError extends Error {
    constructor(reservationNumber) {
        super(`Reservation "${reservationNumber}" is already completely fulfilled.`);
        this.name = 'ReservationFulfilledError';
    }
}
exports.ReservationFulfilledError = ReservationFulfilledError;
class ReservationStockConflictError extends Error {
    constructor(productName, onHand, activeReserved) {
        super(`Stock adjustment conflicts with active reservations for "${productName}". On-hand quantity (${onHand}) would become lower than active reservations (${activeReserved}). Authorized managerial resolution required.`);
        this.name = 'ReservationStockConflictError';
    }
}
exports.ReservationStockConflictError = ReservationStockConflictError;
class CrossBranchReservationError extends Error {
    constructor(expectedBranch, actualBranch) {
        super(`Cross-branch reservation violation: Expected branch "${expectedBranch}", but received "${actualBranch}".`);
        this.name = 'CrossBranchReservationError';
    }
}
exports.CrossBranchReservationError = CrossBranchReservationError;
class InsufficientAvailableStockError extends Error {
    constructor(productName, available, reserved, requested) {
        super(`Insufficient stock: Cannot complete sale of ${requested} units for "${productName}". Available stock is only ${available} units (${reserved} units are committed to active reservations).`);
        this.name = 'InsufficientAvailableStockError';
    }
}
exports.InsufficientAvailableStockError = InsufficientAvailableStockError;
class StockReservationRules {
    /**
     * Calculates available stock:
     * Available = Math.max(0, onHand - activeReserved)
     */
    static calculateAvailableStock(onHandScaled, reservedScaled) {
        return Math.max(0, onHandScaled - reservedScaled);
    }
    /**
     * Determines if a reservation is expired based on current timestamp.
     * Compares UTC date values for resilience against timezone shifts.
     */
    static isExpired(expiresAt, now = new Date().toISOString()) {
        if (!expiresAt)
            return false;
        const expiryTime = new Date(expiresAt).getTime();
        const currentTime = new Date(now).getTime();
        return currentTime > expiryTime;
    }
    /**
     * Validates if sufficient stock is available to create a new reservation commitment.
     */
    static validateAvailabilityForReservation(productName, availableScaled, requestedScaled) {
        if (requestedScaled <= 0) {
            throw new Error(`Reservation quantity must be greater than zero.`);
        }
        if (requestedScaled > availableScaled) {
            throw new ReservationUnavailableStockError(productName, availableScaled / 1000, requestedScaled / 1000);
        }
    }
    /**
     * Validates if an ordinary sale can consume the requested quantity without violating reserved stock.
     */
    static validateSaleAvailability(productName, onHandScaled, reservedScaled, requestedScaled) {
        const available = this.calculateAvailableStock(onHandScaled, reservedScaled);
        if (requestedScaled > available) {
            throw new InsufficientAvailableStockError(productName, available / 1000, reservedScaled / 1000, requestedScaled / 1000);
        }
    }
    /**
     * Validates line-level fulfillment constraints.
     */
    static validateFulfillment(reservation, line, fulfillQuantityScaled, now = new Date().toISOString()) {
        if (reservation.status === 'cancelled') {
            throw new ReservationCancelledError(reservation.reservationNumber);
        }
        if (reservation.status === 'fulfilled') {
            throw new ReservationFulfilledError(reservation.reservationNumber);
        }
        if (reservation.status === 'expired' || this.isExpired(reservation.expiresAt, now)) {
            throw new ReservationExpiredError(reservation.reservationNumber, reservation.expiresAt || '');
        }
        if (fulfillQuantityScaled <= 0) {
            throw new Error(`Fulfillment quantity must be greater than zero.`);
        }
        const remainingReserved = line.reservedQuantityScaled - line.fulfilledQuantityScaled - line.releasedQuantityScaled;
        if (fulfillQuantityScaled > remainingReserved) {
            throw new ReservationOverFulfilmentError(line.id, remainingReserved / 1000, fulfillQuantityScaled / 1000);
        }
    }
    /**
     * Validates that reservation extension is valid.
     */
    static validateCanExtend(reservation, newExpiresAt, now = new Date().toISOString()) {
        if (reservation.status === 'cancelled') {
            throw new ReservationCancelledError(reservation.reservationNumber);
        }
        if (reservation.status === 'fulfilled') {
            throw new ReservationFulfilledError(reservation.reservationNumber);
        }
        const newExpiry = new Date(newExpiresAt).getTime();
        const currentTime = new Date(now).getTime();
        if (newExpiry <= currentTime) {
            throw new Error(`New expiration date (${newExpiresAt}) must be in the future.`);
        }
    }
    /**
     * Validates stock adjustment conflict.
     * If on-hand becomes strictly lower than active reservations, authorized resolution is required.
     */
    static validateAdjustmentReservationConflict(productName, newOnHandScaled, activeReservedScaled, allowConflictOverride = false) {
        if (newOnHandScaled < activeReservedScaled && !allowConflictOverride) {
            throw new ReservationStockConflictError(productName, newOnHandScaled / 1000, activeReservedScaled / 1000);
        }
    }
}
exports.StockReservationRules = StockReservationRules;
