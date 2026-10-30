"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StocktakeRules = exports.StocktakeSecurityError = exports.InvalidStocktakeStateError = exports.StockLocationFrozenError = void 0;
class StockLocationFrozenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StockLocationFrozenError';
        Object.setPrototypeOf(this, StockLocationFrozenError.prototype);
    }
}
exports.StockLocationFrozenError = StockLocationFrozenError;
class InvalidStocktakeStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidStocktakeStateError';
        Object.setPrototypeOf(this, InvalidStocktakeStateError.prototype);
    }
}
exports.InvalidStocktakeStateError = InvalidStocktakeStateError;
class StocktakeSecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StocktakeSecurityError';
        Object.setPrototypeOf(this, StocktakeSecurityError.prototype);
    }
}
exports.StocktakeSecurityError = StocktakeSecurityError;
class StocktakeRules {
    /**
     * Policy B Expected Stock Cutoff Formula:
     * ExpectedAtCountTime = SnapshotStock + MovementsAfterSnapshotAndBeforeCountCutoff
     *
     * Note: cutoffMovementsQtyScaled is the net signed movement (positive for IN, negative for OUT).
     */
    static calculateExpectedStock(snapshotStockScaled, cutoffMovementsQtyScaled) {
        return Math.round(snapshotStockScaled + cutoffMovementsQtyScaled);
    }
    /**
     * Discrepancy Formula:
     * Difference = CountedQuantity - ExpectedQuantity
     *
     * Positive = Surplus (physical stock is greater than expected system stock).
     * Negative = Deficit (physical stock is less than expected system stock).
     */
    static calculateDifference(countedQuantityScaled, expectedQuantityScaled) {
        return Math.round(countedQuantityScaled - expectedQuantityScaled);
    }
    /**
     * Calculates the monetary variance of a discrepancy in minor units.
     */
    static calculateDifferenceValue(differenceQuantityScaled, unitCostMinor, unitPrecision = 3) {
        const cost = unitCostMinor || 0;
        const factor = Math.pow(10, unitPrecision);
        return Math.round((differenceQuantityScaled * cost) / factor);
    }
    /**
     * Validates legal status transitions for the stocktake lifecycle.
     */
    static validateStatusTransition(currentStatus, targetStatus) {
        if (currentStatus === 'posted') {
            throw new InvalidStocktakeStateError('Stocktake has already been posted and is strictly immutable. No further status changes are permitted.');
        }
        if (currentStatus === 'cancelled') {
            throw new InvalidStocktakeStateError('Stocktake has been cancelled and cannot be resumed or modified.');
        }
        if (currentStatus === targetStatus)
            return;
        const legalTransitions = {
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
            throw new InvalidStocktakeStateError(`Invalid stocktake state transition from '${currentStatus}' to '${targetStatus}'. Allowed: ${allowed.join(', ') || 'none'}.`);
        }
    }
    /**
     * Evaluates if a discrepancy requires an automatic recount request based on business thresholds.
     */
    static evaluateRecountRequirement(differenceQuantityScaled, differenceValueMinor, policy) {
        const absQty = Math.abs(differenceQuantityScaled);
        const absVal = Math.abs(differenceValueMinor);
        return (absQty >= policy.autoRecountQtyThresholdScaled ||
            absVal >= policy.autoRecountValueThresholdMinor);
    }
    /**
     * Evaluates resolution between two count attempts.
     */
    static evaluateTwoCounts(count1Scaled, count2Scaled, toleranceScaled = 0) {
        const diff = Math.abs(count1Scaled - count2Scaled);
        if (diff <= toleranceScaled) {
            return { status: 'matching', diffScaled: diff };
        }
        return { status: 'mismatch', diffScaled: diff };
    }
    /**
     * Evaluates resolution between three count attempts.
     */
    static evaluateThreeCounts(count1Scaled, count2Scaled, count3Scaled) {
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
    static maskBlindLineData(line, countingMode, isAuthorizedReviewer) {
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
    static validateLocationFreeze(isLocationFrozen, locationName, stocktakeNumber, overrideFreeze, userRole) {
        if (!isLocationFrozen)
            return;
        if (!overrideFreeze) {
            throw new StockLocationFrozenError(`Stock Location "${locationName}" is currently frozen for active Stocktake #${stocktakeNumber}. Regular stock transactions are temporarily blocked.`);
        }
        // Emergency override requires supervisor or owner privileges
        const authorizedRoles = ['owner', 'admin', 'manager', 'supervisor', 'OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'];
        if (userRole && !authorizedRoles.includes(userRole)) {
            throw new StocktakeSecurityError(`Emergency override of stock location freeze requires supervisor or manager authority. User role '${userRole}' is not permitted.`);
        }
    }
}
exports.StocktakeRules = StocktakeRules;
