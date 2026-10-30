"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryValuationRules = exports.BackdatedPostingRestrictedError = exports.UnauthorizedReturnValuationError = exports.ArbitraryCostMethodSwitchError = void 0;
class ArbitraryCostMethodSwitchError extends Error {
    constructor(productName, currentMethod, requestedMethod) {
        super(`Cannot arbitrarily switch costing method for "${productName}" from "${currentMethod}" to "${requestedMethod}". A controlled inventory revaluation journal with managerial approval is required.`);
        this.name = 'ArbitraryCostMethodSwitchError';
        Object.setPrototypeOf(this, ArbitraryCostMethodSwitchError.prototype);
    }
}
exports.ArbitraryCostMethodSwitchError = ArbitraryCostMethodSwitchError;
class UnauthorizedReturnValuationError extends Error {
    constructor(message = 'Customer returns without an original sales invoice reference require managerial approval and an explicit valuation policy.') {
        super(message);
        this.name = 'UnauthorizedReturnValuationError';
        Object.setPrototypeOf(this, UnauthorizedReturnValuationError.prototype);
    }
}
exports.UnauthorizedReturnValuationError = UnauthorizedReturnValuationError;
class BackdatedPostingRestrictedError extends Error {
    constructor(productName, backdatedTime, latestTransactionTime) {
        super(`Backdated purchase for "${productName}" at ${backdatedTime} is restricted because subsequent outbound transactions exist up to ${latestTransactionTime}. The business accounting policy prohibits historical backdating after sales have posted.`);
        this.name = 'BackdatedPostingRestrictedError';
        Object.setPrototypeOf(this, BackdatedPostingRestrictedError.prototype);
    }
}
exports.BackdatedPostingRestrictedError = BackdatedPostingRestrictedError;
class InventoryValuationRules {
    /**
     * Validates legal costing method.
     */
    static validateCostMethod(method) {
        if (!method)
            return 'weighted_average';
        const normalized = method.toLowerCase().trim();
        if (normalized === 'fifo' || normalized === 'weighted_average') {
            return normalized;
        }
        throw new Error(`Invalid costing method "${method}". Supported methods: 'fifo', 'weighted_average'.`);
    }
    /**
     * Enforces that costing method cannot be switched arbitrarily on a product with existing stock.
     */
    static validateCostMethodSwitch(params) {
        const { productName, currentMethod, requestedMethod, currentStockScaled, hasRevaluationApproval } = params;
        if (currentMethod === requestedMethod)
            return;
        if (!hasRevaluationApproval) {
            throw new ArbitraryCostMethodSwitchError(productName, currentMethod, requestedMethod);
        }
    }
    /**
     * Validates customer return policy.
     * If return is linked to an original sale, allows restoration of original cost.
     * If return has NO sale reference, requires explicit manager authorization.
     */
    static validateReturnValuation(params) {
        const { hasOriginalSale, actorRole, isDamaged, destinationLocationIsSellable } = params;
        if (!hasOriginalSale) {
            const role = (actorRole || '').toLowerCase();
            const isAuthorized = role === 'manager' || role === 'owner' || role === 'admin' || role === 'administrator';
            if (!isAuthorized) {
                throw new UnauthorizedReturnValuationError('Customer return without original invoice reference requires managerial override and an explicit return valuation.');
            }
        }
        // Damaged goods must never be routed directly to sellable stock
        if (isDamaged && destinationLocationIsSellable) {
            throw new Error('Damaged or unsellable returned goods must not be added to sellable stock. They must be routed to a designated quarantine or damaged stock location.');
        }
    }
    /**
     * Validates backdated purchase policy.
     */
    static validateBackdating(params) {
        const { productName, receiptTime, latestOutboundTime, policy } = params;
        if (!latestOutboundTime)
            return;
        const receiptDate = new Date(receiptTime).getTime();
        const latestOutboundDate = new Date(latestOutboundTime).getTime();
        if (receiptDate < latestOutboundDate && policy === 'restrict') {
            throw new BackdatedPostingRestrictedError(productName, receiptTime, latestOutboundTime);
        }
    }
}
exports.InventoryValuationRules = InventoryValuationRules;
