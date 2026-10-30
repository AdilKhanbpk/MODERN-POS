"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodsReceiptRules = exports.UnauthorizedReceiptApprovalError = exports.DiscrepancyReasonRequiredError = exports.BatchRequiredError = exports.SerialCountMismatchError = exports.OverDeliveryError = exports.ArchivedProductError = exports.InactiveSupplierError = exports.InactiveLocationError = exports.ReceiptAfterPOCancelledError = exports.DirectReceiptNotAllowedError = exports.ReceiptAlreadyPostedError = exports.InvalidReceiptStatusTransitionError = exports.GoodsReceiptNotFoundError = exports.InconsistentReceiptQuantitiesError = void 0;
const goods_receipt_math_1 = require("./goods-receipt-math");
class InconsistentReceiptQuantitiesError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InconsistentReceiptQuantitiesError';
    }
}
exports.InconsistentReceiptQuantitiesError = InconsistentReceiptQuantitiesError;
class GoodsReceiptNotFoundError extends Error {
    constructor(identifier) {
        super(`Goods receiving note '${identifier}' was not found.`);
        this.name = 'GoodsReceiptNotFoundError';
    }
}
exports.GoodsReceiptNotFoundError = GoodsReceiptNotFoundError;
class InvalidReceiptStatusTransitionError extends Error {
    constructor(receiptNumber, fromStatus, toStatus) {
        super(`Cannot transition GRN '${receiptNumber}' from status '${fromStatus}' to '${toStatus}'.`);
        this.name = 'InvalidReceiptStatusTransitionError';
    }
}
exports.InvalidReceiptStatusTransitionError = InvalidReceiptStatusTransitionError;
class ReceiptAlreadyPostedError extends Error {
    constructor(receiptNumber) {
        super(`Goods receipt note '${receiptNumber}' is already posted and immutable.`);
        this.name = 'ReceiptAlreadyPostedError';
    }
}
exports.ReceiptAlreadyPostedError = ReceiptAlreadyPostedError;
class DirectReceiptNotAllowedError extends Error {
    constructor() {
        super('Direct receiving without a purchase order is disabled by business configuration.');
        this.name = 'DirectReceiptNotAllowedError';
    }
}
exports.DirectReceiptNotAllowedError = DirectReceiptNotAllowedError;
class ReceiptAfterPOCancelledError extends Error {
    constructor(poNumber) {
        super(`Cannot receive goods against purchase order '${poNumber}' because the order has been cancelled.`);
        this.name = 'ReceiptAfterPOCancelledError';
    }
}
exports.ReceiptAfterPOCancelledError = ReceiptAfterPOCancelledError;
class InactiveLocationError extends Error {
    constructor(locationName) {
        super(`Stock location '${locationName}' is deactivated or inactive.`);
        this.name = 'InactiveLocationError';
    }
}
exports.InactiveLocationError = InactiveLocationError;
class InactiveSupplierError extends Error {
    constructor(supplierName) {
        super(`Supplier '${supplierName}' is inactive or deactivated.`);
        this.name = 'InactiveSupplierError';
    }
}
exports.InactiveSupplierError = InactiveSupplierError;
class ArchivedProductError extends Error {
    constructor(productName) {
        super(`Cannot receive archived product '${productName}'.`);
        this.name = 'ArchivedProductError';
    }
}
exports.ArchivedProductError = ArchivedProductError;
class OverDeliveryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OverDeliveryError';
    }
}
exports.OverDeliveryError = OverDeliveryError;
class SerialCountMismatchError extends Error {
    constructor(productName, expectedCount, actualCount) {
        super(`Serial count mismatch for product '${productName}': expected ${expectedCount} serials to match received quantity, but got ${actualCount}.`);
        this.name = 'SerialCountMismatchError';
    }
}
exports.SerialCountMismatchError = SerialCountMismatchError;
class BatchRequiredError extends Error {
    constructor(productName) {
        super(`Batch-controlled product '${productName}' requires a valid batch number and expiry date upon receipt.`);
        this.name = 'BatchRequiredError';
    }
}
exports.BatchRequiredError = BatchRequiredError;
class DiscrepancyReasonRequiredError extends Error {
    constructor(productName, discrepancyType) {
        super(`Discrepancy explanation reason is required for '${productName}' due to '${discrepancyType}'.`);
        this.name = 'DiscrepancyReasonRequiredError';
    }
}
exports.DiscrepancyReasonRequiredError = DiscrepancyReasonRequiredError;
class UnauthorizedReceiptApprovalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnauthorizedReceiptApprovalError';
    }
}
exports.UnauthorizedReceiptApprovalError = UnauthorizedReceiptApprovalError;
class GoodsReceiptRules {
    /**
     * Validates legal state transitions for Goods Receiving Notes
     */
    static validateStatusTransition(current, target, receiptNumber = '') {
        const allowedTransitions = {
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
    static validateCreateReceipt(params) {
        const { input, supplier, location, productsMap, settings, purchaseOrder } = params;
        // Check direct receipt policy
        if (!input.purchaseOrderId) {
            if (settings && settings.allowDirectReceipt === false) {
                throw new DirectReceiptNotAllowedError();
            }
        }
        else if (purchaseOrder) {
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
            const recon = goods_receipt_math_1.GoodsReceiptMath.validateQuantityReconciliation({
                receivedScaled: line.receivedQuantityScaled,
                acceptedScaled: accepted,
                rejectedScaled: rejected,
                damagedScaled: damaged
            });
            if (!recon.isConsistent) {
                throw new InconsistentReceiptQuantitiesError(recon.errorMessage);
            }
        }
    }
    /**
     * Validates manager approval authorization
     */
    static validateApproval(receipt, actor) {
        const roleUpper = actor.role?.toUpperCase() || '';
        const isApproverRole = ['ADMIN', 'MANAGER', 'OWNER'].includes(roleUpper);
        if (!isApproverRole) {
            throw new UnauthorizedReceiptApprovalError(`User with role '${actor.role}' is not authorized to approve Goods Receiving Notes.`);
        }
    }
    /**
     * Validates posting eligibility
     */
    static validatePosting(receipt, actor) {
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
exports.GoodsReceiptRules = GoodsReceiptRules;
