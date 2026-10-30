import {
  PurchaseOrderStatus,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderSettings,
  CreatePurchaseOrderInput,
  POGoodsReceiptLineInput
} from '../../shared/types/purchase-order';
import { PurchaseOrderMath } from './purchase-order-math';

export class PurchaseOrderNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Purchase order '${identifier}' was not found.`);
    this.name = 'PurchaseOrderNotFoundError';
  }
}

export class InvalidPurchaseOrderStatusError extends Error {
  constructor(poNumber: string, currentStatus: string, action: string) {
    super(`Cannot ${action} purchase order '${poNumber}' in status '${currentStatus}'.`);
    this.name = 'InvalidPurchaseOrderStatusError';
  }
}

export class OverDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverDeliveryError';
  }
}

export class InactiveSupplierError extends Error {
  constructor(supplierName: string) {
    super(`Cannot create or process order for inactive or deactivated supplier '${supplierName}'.`);
    this.name = 'InactiveSupplierError';
  }
}

export class ArchivedProductError extends Error {
  constructor(productName: string) {
    super(`Cannot order or receive archived product '${productName}'.`);
    this.name = 'ArchivedProductError';
  }
}

export class InvalidOrderQuantityError extends Error {
  constructor(productName: string, quantity: number) {
    super(`Invalid order quantity for '${productName}': must be greater than zero (got ${quantity}).`);
    this.name = 'InvalidOrderQuantityError';
  }
}

export class InvalidLinePriceError extends Error {
  constructor(productName: string, price: number) {
    super(`Invalid unit price for '${productName}': must be non-negative (got ${price}).`);
    this.name = 'InvalidLinePriceError';
  }
}

export class UnauthorizedApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedApprovalError';
  }
}

export class OrderClosedError extends Error {
  constructor(poNumber: string) {
    super(`Purchase order '${poNumber}' is closed and cannot receive goods or be modified.`);
    this.name = 'OrderClosedError';
  }
}

export class CannotCancelOrderWithReceiptsError extends Error {
  constructor(poNumber: string) {
    super(`Cannot cancel purchase order '${poNumber}' because goods have already been received. Close remaining quantities instead.`);
    this.name = 'CannotCancelOrderWithReceiptsError';
  }
}

export class PurchaseOrderRules {
  /**
   * Validates state transitions
   */
  public static validateStatusTransition(current: PurchaseOrderStatus, target: PurchaseOrderStatus): void {
    const allowedTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
      draft: ['pending_approval', 'approved', 'cancelled'],
      pending_approval: ['approved', 'draft', 'cancelled'],
      approved: ['sent', 'partially_received', 'fully_received', 'cancelled'],
      sent: ['partially_received', 'fully_received', 'cancelled'],
      partially_received: ['partially_received', 'fully_received', 'partially_invoiced', 'fully_invoiced', 'closed'],
      fully_received: ['partially_invoiced', 'fully_invoiced', 'closed'],
      partially_invoiced: ['fully_invoiced', 'closed'],
      fully_invoiced: ['closed'],
      closed: ['approved'], // Reopened by manager
      cancelled: [] // Terminal
    };

    const allowed = allowedTransitions[current] || [];
    if (!allowed.includes(target)) {
      throw new Error(`Invalid status transition from '${current}' to '${target}'.`);
    }
  }

  /**
   * Validates creation input
   */
  public static validateCreateOrder(
    input: CreatePurchaseOrderInput,
    supplier: { id: string | number; name: string; isActive?: boolean },
    productsMap: Map<string, { id: string | number; name: string; isActive?: boolean }>
  ): void {
    if (supplier.isActive === false) {
      throw new InactiveSupplierError(supplier.name);
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error('Purchase order must contain at least one product line.');
    }

    for (const line of input.lines) {
      const prod = productsMap.get(String(line.productId));
      if (!prod) {
        throw new Error(`Product ID '${line.productId}' not found.`);
      }
      if (prod.isActive === false) {
        throw new ArchivedProductError(prod.name);
      }

      if (line.orderedQuantityScaled <= 0) {
        throw new InvalidOrderQuantityError(prod.name, line.orderedQuantityScaled / 1000);
      }

      if (line.unitPriceMinor < 0) {
        throw new InvalidLinePriceError(prod.name, line.unitPriceMinor);
      }

      if (line.lineDiscountMinor && line.lineDiscountMinor < 0) {
        throw new Error(`Line discount for '${prod.name}' cannot be negative.`);
      }
    }
  }

  /**
   * Validates manager approval authorization
   */
  public static validateApproval(
    po: PurchaseOrder,
    actor: { userId: string | number; role: string },
    settings?: PurchaseOrderSettings | null
  ): void {
    const roleUpper = actor.role?.toUpperCase() || '';
    const isApproverRole = ['ADMIN', 'MANAGER', 'OWNER'].includes(roleUpper);

    if (!isApproverRole) {
      throw new UnauthorizedApprovalError(
        `User with role '${actor.role}' is not authorized to approve purchase orders.`
      );
    }

    // Check self-approval
    if (settings && !settings.allowSelfApproval && String(po.createdBy) === String(actor.userId)) {
      if (roleUpper !== 'ADMIN' && roleUpper !== 'OWNER') {
        throw new UnauthorizedApprovalError(
          `User '${actor.userId}' cannot approve their own purchase order under current business policy.`
        );
      }
    }
  }

  /**
   * Validates goods receipt against order lines
   */
  public static validateGoodsReceipt(
    po: PurchaseOrder,
    receiptLines: POGoodsReceiptLineInput[],
    settings?: PurchaseOrderSettings | null,
    hasManagerApproval = false
  ): void {
    if (po.status === 'cancelled') {
      throw new Error(`Cannot receive goods for cancelled purchase order '${po.purchaseOrderNumber}'.`);
    }

    if (po.status === 'closed') {
      throw new OrderClosedError(po.purchaseOrderNumber);
    }

    if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
      throw new InvalidPurchaseOrderStatusError(po.purchaseOrderNumber, po.status, 'receive goods for');
    }

    const linesMap = new Map<string, PurchaseOrderLine>();
    for (const line of po.lines || []) {
      linesMap.set(line.id, line);
    }

    const policy = settings?.overDeliveryPolicy || 'reject';
    const tolerance = settings?.overDeliveryTolerancePercent || 0;

    for (const rLine of receiptLines) {
      const poLine = linesMap.get(rLine.purchaseOrderLineId);
      if (!poLine) {
        throw new Error(`Purchase order line '${rLine.purchaseOrderLineId}' not found on order.`);
      }

      if (rLine.receivedQuantityScaled <= 0) {
        throw new Error('Received quantity must be greater than zero.');
      }

      const overDeliv = PurchaseOrderMath.evaluateOverDelivery({
        orderedScaled: poLine.orderedQuantityScaled,
        alreadyReceivedScaled: poLine.receivedQuantityScaled,
        incomingScaled: rLine.receivedQuantityScaled,
        policy,
        tolerancePercent: tolerance,
        hasManagerApproval
      });

      if (!overDeliv.isPermitted) {
        throw new OverDeliveryError(
          overDeliv.reason || `Over-delivery on product '${poLine.productName || poLine.productId}' is not permitted.`
        );
      }
    }
  }
}

