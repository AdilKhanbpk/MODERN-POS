import {
  StocktakeStatus,
  StocktakePolicy,
  StocktakeCountingMode
} from '../../shared/types/stocktake';

export class StockLocationFrozenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockLocationFrozenError';
    Object.setPrototypeOf(this, StockLocationFrozenError.prototype);
  }
}

export class InvalidStocktakeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStocktakeStateError';
    Object.setPrototypeOf(this, InvalidStocktakeStateError.prototype);
  }
}

export class StocktakeSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StocktakeSecurityError';
    Object.setPrototypeOf(this, StocktakeSecurityError.prototype);
  }
}

export class StocktakeRules {
  /**
   * Policy B Expected Stock Cutoff Formula:
   * ExpectedAtCountTime = SnapshotStock + MovementsAfterSnapshotAndBeforeCountCutoff
   *
   * Note: cutoffMovementsQtyScaled is the net signed movement (positive for IN, negative for OUT).
   */
  public static calculateExpectedStock(
    snapshotStockScaled: number,
    cutoffMovementsQtyScaled: number
  ): number {
    return Math.round(snapshotStockScaled + cutoffMovementsQtyScaled);
  }

  /**
   * Discrepancy Formula:
   * Difference = CountedQuantity - ExpectedQuantity
   *
   * Positive = Surplus (physical stock is greater than expected system stock).
   * Negative = Deficit (physical stock is less than expected system stock).
   */
  public static calculateDifference(
    countedQuantityScaled: number,
    expectedQuantityScaled: number
  ): number {
    return Math.round(countedQuantityScaled - expectedQuantityScaled);
  }

  /**
   * Calculates the monetary variance of a discrepancy in minor units.
   */
  public static calculateDifferenceValue(
    differenceQuantityScaled: number,
    unitCostMinor: number | null | undefined,
    unitPrecision = 3
  ): number {
    const cost = unitCostMinor || 0;
    const factor = Math.pow(10, unitPrecision);
    return Math.round((differenceQuantityScaled * cost) / factor);
  }

  /**
   * Validates legal status transitions for the stocktake lifecycle.
   */
  public static validateStatusTransition(
    currentStatus: StocktakeStatus,
    targetStatus: StocktakeStatus
  ): void {
    if (currentStatus === 'posted') {
      throw new InvalidStocktakeStateError(
        'Stocktake has already been posted and is strictly immutable. No further status changes are permitted.'
      );
    }

    if (currentStatus === 'cancelled') {
      throw new InvalidStocktakeStateError(
        'Stocktake has been cancelled and cannot be resumed or modified.'
      );
    }

    if (currentStatus === targetStatus) return;

    const legalTransitions: Record<StocktakeStatus, StocktakeStatus[]> = {
      draft: ['in_progress', 'cancelled'],
      in_progress: ['count_submitted', 'review', 'cancelled'],
      count_submitted: ['review', 'in_progress', 'cancelled'],
      review: ['approved', 'in_progress', 'count_submitted', 'cancelled'],
      approved: ['posted', 'review', 'in_progress', 'cancelled'],
      posted: [],
      cancelled: []
    };

    const allowed = legalTransitions[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new InvalidStocktakeStateError(
        `Invalid stocktake state transition from '${currentStatus}' to '${targetStatus}'. Allowed: ${allowed.join(', ') || 'none'}.`
      );
    }
  }

  /**
   * Evaluates if a discrepancy requires an automatic recount request based on business thresholds.
   */
  public static evaluateRecountRequirement(
    differenceQuantityScaled: number,
    differenceValueMinor: number,
    policy: Pick<StocktakePolicy, 'autoRecountQtyThresholdScaled' | 'autoRecountValueThresholdMinor'>
  ): boolean {
    const absQty = Math.abs(differenceQuantityScaled);
    const absVal = Math.abs(differenceValueMinor);

    return (
      absQty >= policy.autoRecountQtyThresholdScaled ||
      absVal >= policy.autoRecountValueThresholdMinor
    );
  }

  /**
   * Evaluates resolution between two count attempts.
   */
  public static evaluateTwoCounts(
    count1Scaled: number,
    count2Scaled: number,
    toleranceScaled = 0
  ): { status: 'matching' | 'mismatch'; diffScaled: number } {
    const diff = Math.abs(count1Scaled - count2Scaled);
    if (diff <= toleranceScaled) {
      return { status: 'matching', diffScaled: diff };
    }
    return { status: 'mismatch', diffScaled: diff };
  }

  /**
   * Evaluates resolution between three count attempts.
   */
  public static evaluateThreeCounts(
    count1Scaled: number,
    count2Scaled: number,
    count3Scaled: number
  ): { status: 'matching' | 'disputed'; acceptedCount?: number } {
    if (count3Scaled === count2Scaled) {
      return { status: 'matching', acceptedCount: count3Scaled };
    }
    if (count3Scaled === count1Scaled) {
      return { status: 'matching', acceptedCount: count3Scaled };
    }
    if (count1Scaled === count2Scaled) {
      return { status: 'matching', acceptedCount: count1Scaled };
    }
    return { status: 'disputed' };
  }

  /**
   * Mask system quantities for blind counting.
   * Strip sensitive expected/system quantities from API/IPC responses when user is a counter in blind mode.
   */
  public static maskBlindLineData<T extends {
    systemQuantityScaled?: number | null;
    differenceQuantityScaled?: number | null;
    expectedQuantityScaled?: number | null;
    differenceValueMinor?: number | null;
  }>(
    line: T,
    countingMode: StocktakeCountingMode,
    isAuthorizedReviewer: boolean
  ): T {
    if (countingMode !== 'blind' || isAuthorizedReviewer) {
      return line;
    }

    return {
      ...line,
      systemQuantityScaled: null,
      differenceQuantityScaled: null,
      expectedQuantityScaled: null,
      differenceValueMinor: null
    };
  }

  /**
   * Validates location freeze policy against incoming operations.
   */
  public static validateLocationFreeze(
    isLocationFrozen: boolean,
    locationName: string,
    stocktakeNumber: string,
    overrideFreeze: boolean,
    userRole?: string
  ): void {
    if (!isLocationFrozen) return;

    if (!overrideFreeze) {
      throw new StockLocationFrozenError(
        `Stock Location "${locationName}" is currently frozen for active Stocktake #${stocktakeNumber}. Regular stock transactions are temporarily blocked.`
      );
    }

    // Emergency override requires supervisor or owner privileges
    const authorizedRoles = ['owner', 'admin', 'manager', 'supervisor', 'OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'];
    if (userRole && !authorizedRoles.includes(userRole)) {
      throw new StocktakeSecurityError(
        `Emergency override of stock location freeze requires supervisor or manager authority. User role '${userRole}' is not permitted.`
      );
    }
  }
}
