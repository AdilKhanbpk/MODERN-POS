import {
  StockReservation,
  StockReservationLine,
  StockReservationStatus
} from '../../shared/types/stock-reservation';

export class ReservationUnavailableStockError extends Error {
  constructor(productName: string, available: number, requested: number) {
    super(
      `Cannot reserve ${requested} units of "${productName}". Only ${available} units are currently available (remaining stock is committed to other reservations).`
    );
    this.name = 'ReservationUnavailableStockError';
  }
}

export class ReservationOverFulfilmentError extends Error {
  constructor(lineId: string, remainingReserved: number, requestedFulfill: number) {
    super(
      `Cannot fulfill ${requestedFulfill} units for line ${lineId}. Remaining active reserved quantity is only ${remainingReserved} units.`
    );
    this.name = 'ReservationOverFulfilmentError';
  }
}

export class ReservationExpiredError extends Error {
  constructor(reservationNumber: string, expiresAt: string) {
    super(
      `Reservation "${reservationNumber}" expired at ${expiresAt} and cannot be fulfilled without an authorized extension.`
    );
    this.name = 'ReservationExpiredError';
  }
}

export class ReservationCancelledError extends Error {
  constructor(reservationNumber: string) {
    super(`Reservation "${reservationNumber}" has been cancelled and cannot be fulfilled or modified.`);
    this.name = 'ReservationCancelledError';
  }
}

export class ReservationFulfilledError extends Error {
  constructor(reservationNumber: string) {
    super(`Reservation "${reservationNumber}" is already completely fulfilled.`);
    this.name = 'ReservationFulfilledError';
  }
}

export class ReservationStockConflictError extends Error {
  constructor(productName: string, onHand: number, activeReserved: number) {
    super(
      `Stock adjustment conflicts with active reservations for "${productName}". On-hand quantity (${onHand}) would become lower than active reservations (${activeReserved}). Authorized managerial resolution required.`
    );
    this.name = 'ReservationStockConflictError';
  }
}

export class CrossBranchReservationError extends Error {
  constructor(expectedBranch: string, actualBranch: string) {
    super(
      `Cross-branch reservation violation: Expected branch "${expectedBranch}", but received "${actualBranch}".`
    );
    this.name = 'CrossBranchReservationError';
  }
}

export class InsufficientAvailableStockError extends Error {
  constructor(productName: string, available: number, reserved: number, requested: number) {
    super(
      `Insufficient stock: Cannot complete sale of ${requested} units for "${productName}". Available stock is only ${available} units (${reserved} units are committed to active reservations).`
    );
    this.name = 'InsufficientAvailableStockError';
  }
}

export class StockReservationRules {
  /**
   * Calculates available stock:
   * Available = Math.max(0, onHand - activeReserved)
   */
  public static calculateAvailableStock(onHandScaled: number, reservedScaled: number): number {
    return Math.max(0, onHandScaled - reservedScaled);
  }

  /**
   * Determines if a reservation is expired based on current timestamp.
   * Compares UTC date values for resilience against timezone shifts.
   */
  public static isExpired(expiresAt: string | null | undefined, now: string = new Date().toISOString()): boolean {
    if (!expiresAt) return false;
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = new Date(now).getTime();
    return currentTime > expiryTime;
  }

  /**
   * Validates if sufficient stock is available to create a new reservation commitment.
   */
  public static validateAvailabilityForReservation(
    productName: string,
    availableScaled: number,
    requestedScaled: number
  ): void {
    if (requestedScaled <= 0) {
      throw new Error(`Reservation quantity must be greater than zero.`);
    }
    if (requestedScaled > availableScaled) {
      throw new ReservationUnavailableStockError(
        productName,
        availableScaled / 1000,
        requestedScaled / 1000
      );
    }
  }

  /**
   * Validates if an ordinary sale can consume the requested quantity without violating reserved stock.
   */
  public static validateSaleAvailability(
    productName: string,
    onHandScaled: number,
    reservedScaled: number,
    requestedScaled: number
  ): void {
    const available = this.calculateAvailableStock(onHandScaled, reservedScaled);
    if (requestedScaled > available) {
      throw new InsufficientAvailableStockError(
        productName,
        available / 1000,
        reservedScaled / 1000,
        requestedScaled / 1000
      );
    }
  }

  /**
   * Validates line-level fulfillment constraints.
   */
  public static validateFulfillment(
    reservation: StockReservation,
    line: StockReservationLine,
    fulfillQuantityScaled: number,
    now: string = new Date().toISOString()
  ): void {
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
      throw new ReservationOverFulfilmentError(
        line.id,
        remainingReserved / 1000,
        fulfillQuantityScaled / 1000
      );
    }
  }

  /**
   * Validates that reservation extension is valid.
   */
  public static validateCanExtend(
    reservation: StockReservation,
    newExpiresAt: string,
    now: string = new Date().toISOString()
  ): void {
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
  public static validateAdjustmentReservationConflict(
    productName: string,
    newOnHandScaled: number,
    activeReservedScaled: number,
    allowConflictOverride: boolean = false
  ): void {
    if (newOnHandScaled < activeReservedScaled && !allowConflictOverride) {
      throw new ReservationStockConflictError(
        productName,
        newOnHandScaled / 1000,
        activeReservedScaled / 1000
      );
    }
  }
}
