"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseOrderRules = exports.CannotCancelOrderWithReceiptsError = exports.OrderClosedError = exports.UnauthorizedApprovalError = exports.InvalidLinePriceError = exports.InvalidOrderQuantityError = exports.ArchivedProductError = exports.InactiveSupplierError = exports.OverDeliveryError = exports.InvalidPurchaseOrderStatusError = exports.PurchaseOrderNotFoundError = void 0;
const purchase_order_math_1 = require("./purchase-order-math");
class PurchaseOrderNotFoundError extends Error {
    constructor(identifier) {
        super(`Purchase order '${identifier}' was not found.`);
        this.name = 'PurchaseOrderNotFoundError';
    }
}
exports.PurchaseOrderNotFoundError = PurchaseOrderNotFoundError;
class InvalidPurchaseOrderStatusError extends Error {
    constructor(poNumber, currentStatus, action) {
        super(`Cannot ${action} purchase order '${poNumber}' in status '${currentStatus}'.`);
        this.name = 'InvalidPurchaseOrderStatusError';
    }
}
exports.InvalidPurchaseOrderStatusError = InvalidPurchaseOrderStatusError;
class OverDeliveryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OverDeliveryError';
    }
}
exports.OverDeliveryError = OverDeliveryError;
class InactiveSupplierError extends Error {
    constructor(supplierName) {
        super(`Cannot create or process order for inactive or deactivated supplier '${supplierName}'.`);
        this.name = 'InactiveSupplierError';
    }
}
exports.InactiveSupplierError = InactiveSupplierError;
class ArchivedProductError extends Error {
    constructor(productName) {
        super(`Cannot order or receive archived product '${productName}'.`);
        this.name = 'ArchivedProductError';
    }
}
exports.ArchivedProductError = ArchivedProductError;
class InvalidOrderQuantityError extends Error {
    constructor(productName, quantity) {
        super(`Invalid order quantity for '${productName}': must be greater than zero (got ${quantity}).`);
        this.name = 'InvalidOrderQuantityError';
    }
}
exports.InvalidOrderQuantityError = InvalidOrderQuantityError;
class InvalidLinePriceError extends Error {
    constructor(productName, price) {
        super(`Invalid unit price for '${productName}': must be non-negative (got ${price}).`);
        this.name = 'InvalidLinePriceError';
    }
}
exports.InvalidLinePriceError = InvalidLinePriceError;
class UnauthorizedApprovalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnauthorizedApprovalError';
    }
}
exports.UnauthorizedApprovalError = UnauthorizedApprovalError;
class OrderClosedError extends Error {
    constructor(poNumber) {
        super(`Purchase order '${poNumber}' is closed and cannot receive goods or be modified.`);
        this.name = 'OrderClosedError';
    }
}
exports.OrderClosedError = OrderClosedError;
class CannotCancelOrderWithReceiptsError extends Error {
    constructor(poNumber) {
        super(`Cannot cancel purchase order '${poNumber}' because goods have already been received. Close remaining quantities instead.`);
        this.name = 'CannotCancelOrderWithReceiptsError';
    }
}
exports.CannotCancelOrderWithReceiptsError = CannotCancelOrderWithReceiptsError;
class PurchaseOrderRules {
    /**
     * Validates state transitions
     */
    static validateStatusTransition(current, target) {
        const allowedTransitions = {
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
    static validateCreateOrder(input, supplier, productsMap) {
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
    static validateApproval(po, actor, settings) {
        const roleUpper = actor.role?.toUpperCase() || '';
        const isApproverRole = ['ADMIN', 'MANAGER', 'OWNER'].includes(roleUpper);
        if (!isApproverRole) {
            throw new UnauthorizedApprovalError(`User with role '${actor.role}' is not authorized to approve purchase orders.`);
        }
        // Check self-approval
        if (settings && !settings.allowSelfApproval && String(po.createdBy) === String(actor.userId)) {
            if (roleUpper !== 'ADMIN' && roleUpper !== 'OWNER') {
                throw new UnauthorizedApprovalError(`User '${actor.userId}' cannot approve their own purchase order under current business policy.`);
            }
        }
    }
    /**
     * Validates goods receipt against order lines
     */
    static validateGoodsReceipt(po, receiptLines, settings, hasManagerApproval = false) {
        if (po.status === 'cancelled') {
            throw new Error(`Cannot receive goods for cancelled purchase order '${po.purchaseOrderNumber}'.`);
        }
        if (po.status === 'closed') {
            throw new OrderClosedError(po.purchaseOrderNumber);
        }
        if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
            throw new InvalidPurchaseOrderStatusError(po.purchaseOrderNumber, po.status, 'receive goods for');
        }
        const linesMap = new Map();
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
            const overDeliv = purchase_order_math_1.PurchaseOrderMath.evaluateOverDelivery({
                orderedScaled: poLine.orderedQuantityScaled,
                alreadyReceivedScaled: poLine.receivedQuantityScaled,
                incomingScaled: rLine.receivedQuantityScaled,
                policy,
                tolerancePercent: tolerance,
                hasManagerApproval
            });
            if (!overDeliv.isPermitted) {
                throw new OverDeliveryError(overDeliv.reason || `Over-delivery on product '${poLine.productName || poLine.productId}' is not permitted.`);
            }
        }
    }
}
exports.PurchaseOrderRules = PurchaseOrderRules;
