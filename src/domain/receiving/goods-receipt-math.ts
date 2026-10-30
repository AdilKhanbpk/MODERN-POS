export interface QuantityReconciliationResult {
  isConsistent: boolean;
  receivedScaled: number;
  acceptedScaled: number;
  rejectedScaled: number;
  damagedScaled: number;
  expectedSumScaled: number;
  differenceScaled: number;
  errorMessage?: string;
}

export interface CalculatedReceiptLineAmounts {
  baseReceivedScaled: number;
  baseAcceptedScaled: number;
  baseDamagedScaled: number;
  baseRejectedScaled: number;
  lineAcceptedCostMinor: number;
  lineDamagedCostMinor: number;
  lineRejectedCostMinor: number;
  lineTotalCostMinor: number;
}

export class GoodsReceiptMath {
  /**
   * Enforces the fundamental GRN invariant:
   * Received = Accepted + Rejected + Damaged
   */
  public static validateQuantityReconciliation(params: {
    receivedScaled: number;
    acceptedScaled: number;
    rejectedScaled: number;
    damagedScaled: number;
  }): QuantityReconciliationResult {
    const received = params.receivedScaled;
    const accepted = params.acceptedScaled;
    const rejected = params.rejectedScaled;
    const damaged = params.damagedScaled;

    const expectedSum = accepted + rejected + damaged;
    const difference = received - expectedSum;
    const isConsistent = difference === 0;

    let errorMessage: string | undefined;
    if (!isConsistent) {
      errorMessage = `Inconsistent receipt quantities: Physically received (${received / 1000}) must equal Accepted (${accepted / 1000}) + Rejected (${rejected / 1000}) + Damaged (${damaged / 1000}), but sum is ${expectedSum / 1000} (discrepancy: ${difference / 1000}).`;
    }

    return {
      isConsistent,
      receivedScaled: received,
      acceptedScaled: accepted,
      rejectedScaled: rejected,
      damagedScaled: damaged,
      expectedSumScaled: expectedSum,
      differenceScaled: difference,
      errorMessage
    };
  }

  /**
   * Converts received, accepted, damaged, and rejected quantities to base units
   * using immutable snapshot ratios and calculates exact minor currency valuations.
   */
  public static calculateLineQuantitiesAndCost(params: {
    receivedScaled: number;
    acceptedScaled: number;
    rejectedScaled: number;
    damagedScaled: number;
    conversionNumerator: number;
    conversionDenominator: number;
    unitCostMinor?: number | null;
  }): CalculatedReceiptLineAmounts {
    const num = params.conversionNumerator || 1;
    const den = params.conversionDenominator || 1;

    const baseReceivedScaled = Math.round((params.receivedScaled * num) / den);
    const baseAcceptedScaled = Math.round((params.acceptedScaled * num) / den);
    const baseDamagedScaled = Math.round((params.damagedScaled * num) / den);
    const baseRejectedScaled = Math.round((params.rejectedScaled * num) / den);

    const unitCost = params.unitCostMinor || 0;

    // Line valuations in integer minor currency units
    const lineAcceptedCostMinor = Math.round((baseAcceptedScaled / 1000) * unitCost);
    const lineDamagedCostMinor = Math.round((baseDamagedScaled / 1000) * unitCost);
    const lineRejectedCostMinor = Math.round((baseRejectedScaled / 1000) * unitCost);
    const lineTotalCostMinor = Math.round((baseReceivedScaled / 1000) * unitCost);

    return {
      baseReceivedScaled,
      baseAcceptedScaled,
      baseDamagedScaled,
      baseRejectedScaled,
      lineAcceptedCostMinor,
      lineDamagedCostMinor,
      lineRejectedCostMinor,
      lineTotalCostMinor
    };
  }

  /**
   * Evaluates over-delivery against purchase order line and business policy
   */
  public static evaluateOverDelivery(params: {
    orderedScaled: number;
    alreadyReceivedScaled: number;
    incomingScaled: number;
    policy: 'reject' | 'allow_tolerance' | 'require_approval';
    tolerancePercent: number;
    hasManagerApproval?: boolean;
  }): {
    isOverDelivery: boolean;
    excessScaled: number;
    isPermitted: boolean;
    reason?: string;
  } {
    const totalAfterReceipt = params.alreadyReceivedScaled + params.incomingScaled;
    if (totalAfterReceipt <= params.orderedScaled) {
      return { isOverDelivery: false, excessScaled: 0, isPermitted: true };
    }

    const excessScaled = totalAfterReceipt - params.orderedScaled;

    if (params.hasManagerApproval) {
      return { isOverDelivery: true, excessScaled, isPermitted: true };
    }

    if (params.policy === 'reject') {
      return {
        isOverDelivery: true,
        excessScaled,
        isPermitted: false,
        reason: `Over-delivery rejected: order quantity is ${params.orderedScaled / 1000}, but receipt would total ${totalAfterReceipt / 1000}. Policy strictly blocks excess.`
      };
    }

    if (params.policy === 'allow_tolerance') {
      const maxAllowedScaled = Math.round(params.orderedScaled * (1 + params.tolerancePercent / 100));
      if (totalAfterReceipt <= maxAllowedScaled) {
        return { isOverDelivery: true, excessScaled, isPermitted: true };
      }
      return {
        isOverDelivery: true,
        excessScaled,
        isPermitted: false,
        reason: `Over-delivery exceeds tolerance limit of ${params.tolerancePercent}% (${maxAllowedScaled / 1000} units). Total received would be ${totalAfterReceipt / 1000} units.`
      };
    }

    if (params.policy === 'require_approval') {
      return {
        isOverDelivery: true,
        excessScaled,
        isPermitted: false,
        reason: 'Over-delivery requires manager approval.'
      };
    }

    return { isOverDelivery: true, excessScaled, isPermitted: false };
  }
}

