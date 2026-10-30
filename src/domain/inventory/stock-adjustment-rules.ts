import {
  StockAdjustmentType,
  StockAdjustmentReasonCode,
  StockAdjustmentStatus,
  StockAdjustmentApprovalPolicy
} from '../../shared/types/stock-adjustment';

export class InvalidPhysicalCountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhysicalCountError';
  }
}

export class InvalidAdjustmentReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdjustmentReasonError';
  }
}

export class SelfApprovalDisallowedError extends Error {
  constructor(message: string = 'Requester cannot approve their own adjustment under current business policy') {
    super(message);
    this.name = 'SelfApprovalDisallowedError';
  }
}

export class UnauthorizedApproverError extends Error {
  constructor(message: string = 'User does not possess the required role to approve stock adjustments') {
    super(message);
    this.name = 'UnauthorizedApproverError';
  }
}

export class StockDriftConflictError extends Error {
  public readonly snapshotSystemQty: number;
  public readonly currentOnHand: number;
  public readonly driftAmount: number;

  constructor(
    productName: string,
    snapshotSystemQty: number,
    currentOnHand: number
  ) {
    const drift = currentOnHand - snapshotSystemQty;
    super(
      `Stock drift detected for product '${productName}'. System snapshot was ${snapshotSystemQty / 1000} units, but current stock is ${currentOnHand / 1000} units (drift: ${drift > 0 ? '+' : ''}${drift / 1000} units). Another transaction modified inventory after this adjustment was prepared. Refresh to re-confirm.`
    );
    this.name = 'StockDriftConflictError';
    this.snapshotSystemQty = snapshotSystemQty;
    this.currentOnHand = currentOnHand;
    this.driftAmount = drift;
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: StockAdjustmentStatus, to: StockAdjustmentStatus) {
    super(`Cannot transition stock adjustment from '${from}' to '${to}'`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class AdjustmentAlreadyPostedError extends Error {
  constructor(adjustmentNumber: string) {
    super(`Stock adjustment '${adjustmentNumber}' is already posted and immutable. Use a reversal to correct it.`);
    this.name = 'AdjustmentAlreadyPostedError';
  }
}

export const VALID_REASON_CODES: readonly StockAdjustmentReasonCode[] = [
  'DAMAGED',
  'EXPIRED',
  'MISSING',
  'THEFT',
  'BROKEN',
  'FOUND_STOCK',
  'DATA_CORRECTION',
  'OPENING_BALANCE_CORRECTION',
  'OTHER'
] as const;

export const VALID_ADJUSTMENT_TYPES: readonly StockAdjustmentType[] = [
  'increase',
  'decrease',
  'damage',
  'expiry',
  'correction',
  'other'
] as const;

export class StockAdjustmentRules {
  /**
   * Calculates difference between physical count and system quantity:
   * Difference = CountedQuantity - SystemQuantity
   *
   * Example:
   * - System stock: 100. Counted stock: 93 -> 93 - 100 = -7 (decrease by 7).
   * - System stock: 50. Counted stock: 54 -> 54 - 50 = +4 (increase by 4).
   */
  public static calculateDifference(
    countedQuantityScaled: number,
    systemQuantityScaled: number
  ): number {
    return Math.round(countedQuantityScaled - systemQuantityScaled);
  }

  /**
   * Validates physical count magnitude. Physical counts cannot be negative.
   */
  public static validatePhysicalCount(countedQuantityScaled: number): void {
    if (isNaN(countedQuantityScaled) || countedQuantityScaled < 0) {
      throw new InvalidPhysicalCountError(
        `Physical stock count cannot be negative or NaN. Received: ${countedQuantityScaled}`
      );
    }
  }

  /**
   * Validates reason code and reason description.
   * If reason code is 'OTHER', description is strictly mandatory with at least 5 characters.
   */
  public static validateReason(
    reasonCode: string,
    reasonDescription?: string | null
  ): void {
    const code = reasonCode?.toUpperCase() as StockAdjustmentReasonCode;
    if (!VALID_REASON_CODES.includes(code)) {
      throw new InvalidAdjustmentReasonError(
        `Invalid reason code '${reasonCode}'. Allowed codes: ${VALID_REASON_CODES.join(', ')}`
      );
    }

    const trimmedDesc = reasonDescription?.trim() || '';
    if (!trimmedDesc) {
      throw new InvalidAdjustmentReasonError(
        `Reason description is required for stock adjustments with reason '${reasonCode}'`
      );
    }

    if (code === 'OTHER' && trimmedDesc.length < 5) {
      throw new InvalidAdjustmentReasonError(
        `Detailed description is strictly required when reason code is 'OTHER' (minimum 5 characters)`
      );
    }
  }

  /**
   * Validates adjustment type against recognized business types.
   */
  public static validateAdjustmentType(type: string): void {
    if (!VALID_ADJUSTMENT_TYPES.includes(type as StockAdjustmentType)) {
      throw new InvalidAdjustmentReasonError(
        `Invalid adjustment type '${type}'. Allowed types: ${VALID_ADJUSTMENT_TYPES.join(', ')}`
      );
    }
  }

  /**
   * Evaluates whether an adjustment requires managerial approval.
   */
  public static evaluateApprovalNeed(
    lines: Array<{
      differenceQuantityScaled: number;
      totalValueMinor?: number | null;
    }>,
    adjustmentType: StockAdjustmentType,
    policy: StockAdjustmentApprovalPolicy,
    actorRole: string
  ): { requiresApproval: boolean; reasons: string[] } {
    // An OWNER is the ultimate business authority and does not require third-party approval
    if (actorRole.toUpperCase() === 'OWNER') {
      return { requiresApproval: false, reasons: [] };
    }

    const reasons: string[] = [];

    // 1. Role Check: If user is not an approver role, they cannot auto-approve
    const isApproverRole = policy.approverRoles
      .map((r) => r.toUpperCase())
      .includes(actorRole.toUpperCase());

    if (!isApproverRole) {
      reasons.push(`User role '${actorRole}' is not an authorized approver role`);
    }

    // 2. Adjustment Type Check: Specific types always mandate approval (e.g. damage, expiry, theft)
    if (policy.requireApprovalForTypes.includes(adjustmentType)) {
      reasons.push(`Adjustment type '${adjustmentType}' strictly requires managerial approval`);
    }

    // 3. Quantity Threshold Check: Any line exceeding maximum auto-approve quantity
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const absQty = Math.abs(line.differenceQuantityScaled);
      if (absQty > policy.maxAutoApproveQtyScaled) {
        reasons.push(
          `Line ${i + 1} difference magnitude (${absQty / 1000} units) exceeds auto-approve threshold of ${
            policy.maxAutoApproveQtyScaled / 1000
          } units`
        );
        break;
      }
    }

    // 4. Monetary Value Threshold Check: Total absolute value impact
    const totalAbsValueMinor = lines.reduce(
      (sum, l) => sum + Math.abs(l.totalValueMinor || 0),
      0
    );
    if (totalAbsValueMinor > policy.maxAutoApproveValueMinor) {
      reasons.push(
        `Total value impact (${totalAbsValueMinor / 100} currency units) exceeds auto-approve threshold of ${
          policy.maxAutoApproveValueMinor / 100
        }`
      );
    }

    return {
      requiresApproval: reasons.length > 0,
      reasons
    };
  }

  /**
   * Validates that the approving actor is authorized and prevents self-approval unless permitted.
   */
  public static validateApprovalActor(
    requesterId: string,
    approverId: string,
    approverRole: string,
    policy: StockAdjustmentApprovalPolicy
  ): void {
    const isAuthorizedRole = policy.approverRoles
      .map((r) => r.toUpperCase())
      .includes(approverRole.toUpperCase());

    if (!isAuthorizedRole) {
      throw new UnauthorizedApproverError(
        `Role '${approverRole}' is not authorized to approve stock adjustments. Required roles: ${policy.approverRoles.join(
          ', '
        )}`
      );
    }

    if (String(requesterId) === String(approverId) && !policy.allowSelfApproval && approverRole.toUpperCase() !== 'OWNER') {
      throw new SelfApprovalDisallowedError(
        `Requester '${requesterId}' cannot approve their own stock adjustment under current business policy`
      );
    }
  }

  /**
   * Detects whether another transaction modified inventory after the adjustment was prepared.
   */
  public static validateStockDrift(
    productName: string,
    snapshotSystemQtyScaled: number,
    currentOnHandScaled: number
  ): void {
    if (Math.round(snapshotSystemQtyScaled) !== Math.round(currentOnHandScaled)) {
      throw new StockDriftConflictError(
        productName,
        snapshotSystemQtyScaled,
        currentOnHandScaled
      );
    }
  }

  /**
   * Enforces business negative stock policy during stock decreases.
   */
  public static validateNegativeStock(
    productName: string,
    currentOnHandScaled: number,
    differenceScaled: number,
    allowNegativeStock: boolean
  ): void {
    if (differenceScaled < 0) {
      const remaining = currentOnHandScaled + differenceScaled;
      if (remaining < 0 && !allowNegativeStock) {
        throw new Error(
          `Stock adjustment decrease of ${Math.abs(differenceScaled) / 1000} units would drive product '${productName}' stock negative (${remaining / 1000} units). Business policy prohibits negative inventory.`
        );
      }
    }
  }

  /**
   * Validates legal status transitions.
   */
  public static validateStatusTransition(
    currentStatus: StockAdjustmentStatus,
    targetStatus: StockAdjustmentStatus
  ): void {
    if (currentStatus === targetStatus) return;

    if (currentStatus === 'posted') {
      throw new InvalidStatusTransitionError(currentStatus, targetStatus);
    }

    if (currentStatus === 'rejected' || currentStatus === 'cancelled') {
      throw new InvalidStatusTransitionError(currentStatus, targetStatus);
    }

    const validNextStatuses: Record<StockAdjustmentStatus, StockAdjustmentStatus[]> = {
      draft: ['pending_approval', 'approved', 'posted', 'cancelled'],
      pending_approval: ['approved', 'rejected', 'cancelled'],
      approved: ['posted', 'cancelled'],
      posted: [],
      rejected: [],
      cancelled: []
    };

    if (!validNextStatuses[currentStatus].includes(targetStatus)) {
      throw new InvalidStatusTransitionError(currentStatus, targetStatus);
    }
  }
}
