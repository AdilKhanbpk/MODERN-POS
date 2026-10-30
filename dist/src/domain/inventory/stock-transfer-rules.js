"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockTransferRules = exports.TransferImmutabilityError = exports.InvalidTransferStateError = exports.TransferOverReceiptError = exports.CrossBranchMismatchError = exports.CrossBranchTransferDisabledError = exports.InsufficientSourceStockError = void 0;
class InsufficientSourceStockError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InsufficientSourceStockError';
        Object.setPrototypeOf(this, InsufficientSourceStockError.prototype);
    }
}
exports.InsufficientSourceStockError = InsufficientSourceStockError;
class CrossBranchTransferDisabledError extends Error {
    constructor(message = 'Inter-branch stock transfers require the Multi-Branch module to be enabled.') {
        super(message);
        this.name = 'CrossBranchTransferDisabledError';
        Object.setPrototypeOf(this, CrossBranchTransferDisabledError.prototype);
    }
}
exports.CrossBranchTransferDisabledError = CrossBranchTransferDisabledError;
class CrossBranchMismatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CrossBranchMismatchError';
        Object.setPrototypeOf(this, CrossBranchMismatchError.prototype);
    }
}
exports.CrossBranchMismatchError = CrossBranchMismatchError;
class TransferOverReceiptError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransferOverReceiptError';
        Object.setPrototypeOf(this, TransferOverReceiptError.prototype);
    }
}
exports.TransferOverReceiptError = TransferOverReceiptError;
class InvalidTransferStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidTransferStateError';
        Object.setPrototypeOf(this, InvalidTransferStateError.prototype);
    }
}
exports.InvalidTransferStateError = InvalidTransferStateError;
class TransferImmutabilityError extends Error {
    constructor(message = 'Posted/completed stock transfers are strictly immutable and cannot be edited.') {
        super(message);
        this.name = 'TransferImmutabilityError';
        Object.setPrototypeOf(this, TransferImmutabilityError.prototype);
    }
}
exports.TransferImmutabilityError = TransferImmutabilityError;
class StockTransferRules {
    /**
     * Normalizes transfer type string to standard representation.
     */
    static normalizeType(type) {
        if (!type)
            return 'internal';
        const lower = type.toLowerCase().trim();
        if (lower === 'internal' || lower === 'internal_location') {
            return 'internal';
        }
        if (lower === 'inter_branch' || lower === 'branch_transfer' || lower.includes('branch')) {
            return 'inter_branch';
        }
        return 'internal';
    }
    /**
     * Normalizes status to lowercase standard.
     */
    static normalizeStatus(status) {
        if (!status)
            return 'draft';
        const s = status.toLowerCase();
        if (s === 'completed')
            return 'received';
        if (s === 'pending')
            return 'requested';
        return s;
    }
    /**
     * Validates source and destination locations for transfers.
     */
    static validateTransferLocations(params) {
        const { sourceLocation: src, destinationLocation: dest, isMultiBranchEnabled, declaredTransferType } = params;
        // 1. Same location check
        if (src.id === dest.id) {
            throw new Error(`Source and destination locations cannot be the same ("${src.name}").`);
        }
        // 2. Multi-tenant isolation check
        if (src.businessId !== dest.businessId) {
            throw new Error('Source and destination locations must belong to the exact same business.');
        }
        // 3. Active status check
        if (!src.isActive) {
            throw new Error(`Source stock location "${src.name}" is deactivated/inactive.`);
        }
        if (!dest.isActive) {
            throw new Error(`Destination stock location "${dest.name}" is deactivated/inactive.`);
        }
        // 4. Receivable check
        if (!dest.isReceivable) {
            throw new Error(`Destination location "${dest.name}" is not authorized to receive inventory (is_receivable = 0).`);
        }
        // 5. Cross-branch evaluation
        const isInterBranch = src.branchId !== dest.branchId;
        if (isInterBranch) {
            if (!isMultiBranchEnabled) {
                throw new CrossBranchTransferDisabledError(`Cannot transfer from Branch "${src.branchId}" to Branch "${dest.branchId}". Multi-Branch module is not enabled for this business.`);
            }
            const normalized = this.normalizeType(declaredTransferType);
            if (declaredTransferType && normalized === 'internal') {
                throw new CrossBranchMismatchError(`Transfer between different branches ("${src.branchId}" -> "${dest.branchId}") cannot be categorized as an internal transfer.`);
            }
            return 'inter_branch';
        }
        return 'internal';
    }
    /**
     * Validates legal status transitions.
     */
    static validateStatusTransition(currentStatus, targetStatus) {
        const curr = this.normalizeStatus(currentStatus);
        const target = this.normalizeStatus(targetStatus);
        if (curr === 'received') {
            throw new TransferImmutabilityError('Stock transfer has already been completed and received. It is strictly immutable and cannot be altered.');
        }
        if (curr === 'cancelled') {
            throw new InvalidTransferStateError('Stock transfer has been cancelled and cannot be resumed or modified.');
        }
        if (curr === 'rejected') {
            throw new InvalidTransferStateError('Stock transfer has been rejected.');
        }
        if (curr === target)
            return;
        const allowedTransitions = {
            draft: ['requested', 'approved', 'cancelled'],
            requested: ['approved', 'rejected', 'cancelled'],
            approved: ['dispatched', 'cancelled'],
            dispatched: ['partially_received', 'received'],
            partially_received: ['partially_received', 'received'],
            received: [],
            cancelled: [],
            rejected: [],
            DRAFT: ['requested', 'approved', 'cancelled'],
            PENDING: ['approved', 'rejected', 'cancelled'],
            COMPLETED: [],
            CANCELLED: []
        };
        const allowed = allowedTransitions[curr] || [];
        if (!allowed.includes(target)) {
            throw new InvalidTransferStateError(`Invalid transfer state transition from '${curr}' to '${target}'. Allowed: ${allowed.join(', ') || 'none'}.`);
        }
    }
    /**
     * Validates source stock availability before dispatch.
     */
    static validateStockAvailability(availableScaled, requestedScaled, productName) {
        if (requestedScaled <= 0) {
            throw new Error(`Transfer quantity for "${productName}" must be strictly greater than zero.`);
        }
        if (availableScaled < requestedScaled) {
            throw new InsufficientSourceStockError(`Insufficient available stock for "${productName}". Requested: ${requestedScaled / 1000}, Available: ${availableScaled / 1000}.`);
        }
    }
    /**
     * Validates receipt quantities and determines full vs partial completion.
     */
    static evaluateReceiptQuantities(params) {
        const { dispatchedScaled, receivedScaled, rejectedScaled = 0, lossScaled = 0, previousReceivedScaled = 0, previousRejectedScaled = 0, previousLossScaled = 0 } = params;
        const currentTotal = receivedScaled + rejectedScaled + lossScaled;
        const previousTotal = previousReceivedScaled + previousRejectedScaled + previousLossScaled;
        const totalAccounted = currentTotal + previousTotal;
        if (totalAccounted > dispatchedScaled) {
            throw new TransferOverReceiptError(`Total accounted quantity (${totalAccounted / 1000}) exceeds dispatched quantity (${dispatchedScaled / 1000}). Over-receipt is prohibited.`);
        }
        const remainingInTransit = dispatchedScaled - totalAccounted;
        return {
            isFullyAccounted: remainingInTransit === 0,
            remainingInTransitScaled: remainingInTransit,
            totalAccountedScaled: totalAccounted
        };
    }
}
exports.StockTransferRules = StockTransferRules;
