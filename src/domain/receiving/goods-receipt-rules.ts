import {
  GoodsReceiptStatus,
  GoodsReceipt,
  GoodsReceiptLine,
  GoodsReceiptSettings,
  CreateGoodsReceiptInput
} from '../../shared/types/goods-receipt';
import { GoodsReceiptMath } from './goods-receipt-math';

export class InconsistentReceiptQuantitiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InconsistentReceiptQuantitiesError';
  }
}

export class GoodsReceiptNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Goods receiving note '${identifier}' was not found.`);
    this.name = 'GoodsReceiptNotFoundError';
  }
}

export class InvalidReceiptStatusTransitionError extends Error {
  constructor(receiptNumber: string, fromStatus: string, toStatus: string) {
    super(`Cannot transition GRN '${receiptNumber}' from status '${fromStatus}' to '${toStatus}'.`);
    this.name = 'InvalidReceiptStatusTransitionError';
  }
}

export class ReceiptAlreadyPostedError extends Error {
  constructor(receiptNumber: string) {
    super(`Goods receipt note '${receiptNumber}' is already posted and immutable.`);
    this.name = 'ReceiptAlreadyPostedError';
  }
}

export class DirectReceiptNotAllowedError extends Error {
  constructor() {
    super('Direct receiving without a purchase order is disabled by business configuration.');
    this.name = 'DirectReceiptNotAllowedError';
  }
}

export class ReceiptAfterPOCancelledError extends Error {
  constructor(poNumber: string) {
    super(`Cannot receive goods against purchase order '${poNumber}' because the order has been cancelled.`);
    this.name = 'ReceiptAfterPOCancelledError';
  }
}

export class InactiveLocationError extends Error {
  constructor(locationName: string) {
    super(`Stock location '${locationName}' is deactivated or inactive.`);
    this.name = 'InactiveLocationError';
  }
}

export class InactiveSupplierError extends Error {
  constructor(supplierName: string) {
    super(`Supplier '${supplierName}' is inactive or deactivated.`);
    this.name = 'InactiveSupplierError';
  }
}

export class ArchivedProductError extends Error {
  constructor(productName: string) {
    super(`Cannot receive archived product '${productName}'.`);
    this.name = 'ArchivedProductError';
  }
}

export class OverDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverDeliveryError';
  }
}

export class SerialCountMismatchError extends Error {
  constructor(productName: string, expectedCount: number, actualCount: number) {
    super(`Serial count mismatch for product '${productName}': expected ${expectedCount} serials to match received quantity, but got ${actualCount}.`);
    this.name = 'SerialCountMismatchError';
  }
}

export class BatchRequiredError extends Error {
  constructor(productName: string) {
    super(`Batch-controlled product '${productName}' requires a valid batch number and expiry date upon receipt.`);
    this.name = 'BatchRequiredError';
  }
}

export class DiscrepancyReasonRequiredError extends Error {
  constructor(productName: string, discrepancyType: string) {
    super(`Discrepancy explanation reason is required for '${productName}' due to '${discrepancyType}'.`);
    this.name = 'DiscrepancyReasonRequiredError';
  }
}

export class UnauthorizedReceiptApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedReceiptApprovalError';
  }
}

export class GoodsReceiptRules {
  /**
   * Validates legal state transitions for Goods Receiving Notes
   */
  public static validateStatusTransition(current: GoodsReceiptStatus, target: GoodsReceiptStatus, receiptNumber = ''): void {
    const allowedTransitions: Record<GoodsReceiptStatus, GoodsReceiptStatus[]> = {
      draft: ['pending_inspection', 'pending_approval', 'approved', 'posted', 'cancelled'],
      pending_inspection: ['pending_approval', 'approved', 'draft', 'cancelled'],
      pending_approval: ['approved', 'draft', 'cancelled'],
      approved: ['posted', 'cancelled'],
      posted: [], // Terminal & immutable
      cancelled: [] // Terminal
    };

    const allowed = allowedTransitions[current] || [];
    if (!allowed.includes(target)) {
      throw new InvalidReceiptStatusTransitionError(receiptNumber, current, target);
    }
  }

  /**
   * Validates GRN creation input
   */
  public static validateCreateReceipt(params: {
    input: CreateGoodsReceiptInput;
    supplier: { id: string | number; name: string; isActive?: boolean };
    location: { id: string; name: string; isActive?: boolean };
    productsMap: Map<string, { id: string | number; name: string; isActive?: boolean }>;
    settings?: GoodsReceiptSettings | null;
    purchaseOrder?: { id: string; purchaseOrderNumber: string; status: string } | null;
  }): void {
    const { input, supplier, location, productsMap, settings, purchaseOrder } = params;

    // Check direct receipt policy
    if (!input.purchaseOrderId) {
      if (settings && settings.allowDirectReceipt === false) {
        throw new DirectReceiptNotAllowedError();
      }
    } else if (purchaseOrder) {
      if (purchaseOrder.status === 'cancelled') {
        throw new ReceiptAfterPOCancelledError(purchaseOrder.purchaseOrderNumber);
      }
    }

    if (supplier.isActive === false) {
      throw new InactiveSupplierError(supplier.name);
    }

    if (location.isActive === false) {
      throw new InactiveLocationError(location.name);
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error('Goods receiving note must contain at least one line item.');
    }

    for (const line of input.lines) {
      const prod = productsMap.get(String(line.productId));
      if (!prod) {
        throw new Error(`Product '${line.productId}' was not found.`);
      }
      if (prod.isActive === false) {
        throw new ArchivedProductError(prod.name);
      }

      if (line.receivedQuantityScaled < 0) {
        throw new Error(`Received quantity for '${prod.name}' cannot be negative.`);
      }

      // Quantity reconciliation invariant check: Received = Accepted + Rejected + Damaged
      // If accepted/rejected/damaged are provided, they must equal received
      const accepted = line.acceptedQuantityScaled ?? line.receivedQuantityScaled;
      const rejected = line.rejectedQuantityScaled ?? 0;
      const damaged = line.damagedQuantityScaled ?? 0;

      const recon = GoodsReceiptMath.validateQuantityReconciliation({
        receivedScaled: line.receivedQuantityScaled,
        acceptedScaled: accepted,
        rejectedScaled: rejected,
        damagedScaled: damaged
      });

      if (!recon.isConsistent) {
        throw new InconsistentReceiptQuantitiesError(recon.errorMessage!);
      }
    }
  }

  /**
   * Validates manager approval authorization
   */
  public static validateApproval(
    receipt: GoodsReceipt,
    actor: { userId: string | number; role: string }
  ): void {
    const roleUpper = actor.role?.toUpperCase() || '';
    const isApproverRole = ['ADMIN', 'MANAGER', 'OWNER'].includes(roleUpper);

    if (!isApproverRole) {
      throw new UnauthorizedReceiptApprovalError(
        `User with role '${actor.role}' is not authorized to approve Goods Receiving Notes.`
      );
    }
  }

  /**
   * Validates posting eligibility
   */
  public static validatePosting(
    receipt: GoodsReceipt,
    actor: { userId: string | number; role: string }
  ): void {
    if (receipt.status === 'posted') {
      throw new ReceiptAlreadyPostedError(receipt.receiptNumber);
    }

    if (receipt.status === 'cancelled') {
      throw new Error(`Cannot post cancelled goods receipt '${receipt.receiptNumber}'.`);
    }

    if (receipt.status === 'pending_inspection') {
      throw new Error(`Goods receipt '${receipt.receiptNumber}' is still pending inspection. Inspect and approve before posting.`);
    }
  }
}

