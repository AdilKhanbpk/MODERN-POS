"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplenishmentRules = exports.TargetStockBelowMinimumError = exports.ReplenishmentRuleValidationError = exports.InvalidReorderRuleError = exports.InactiveSupplierReplenishmentError = void 0;
class InactiveSupplierReplenishmentError extends Error {
    constructor(supplierName) {
        super(`Cannot generate purchase order for inactive supplier "${supplierName}".`);
        this.name = 'InactiveSupplierReplenishmentError';
    }
}
exports.InactiveSupplierReplenishmentError = InactiveSupplierReplenishmentError;
class InvalidReorderRuleError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidReorderRuleError';
    }
}
exports.InvalidReorderRuleError = InvalidReorderRuleError;
class ReplenishmentRuleValidationError extends InvalidReorderRuleError {
}
exports.ReplenishmentRuleValidationError = ReplenishmentRuleValidationError;
class TargetStockBelowMinimumError extends InvalidReorderRuleError {
}
exports.TargetStockBelowMinimumError = TargetStockBelowMinimumError;
class ReplenishmentRules {
    /**
     * Validates product reorder rule parameter integrity.
     */
    static validateReorderRule(rule) {
        const min = rule.minimumStockScaled || 0;
        const rop = rule.reorderPointScaled || 0;
        const target = rule.targetStockScaled || 0;
        const leadTime = rule.leadTimeDays || 0;
        const safety = rule.safetyStockScaled || 0;
        if (min < 0) {
            throw new ReplenishmentRuleValidationError(`Minimum stock cannot be negative.`);
        }
        if (rop < 0) {
            throw new ReplenishmentRuleValidationError(`Reorder point cannot be negative.`);
        }
        if (target < 0) {
            throw new ReplenishmentRuleValidationError(`Target stock cannot be negative.`);
        }
        if (target > 0 && min > 0 && target < min) {
            throw new TargetStockBelowMinimumError(`Target stock (${target / 1000}) cannot be less than minimum stock (${min / 1000}).`);
        }
        if (target > 0 && rop > 0 && target < rop) {
            throw new ReplenishmentRuleValidationError(`Target stock (${target / 1000}) cannot be less than reorder point (${rop / 1000}).`);
        }
        if (leadTime < 0) {
            throw new ReplenishmentRuleValidationError(`Supplier lead time days cannot be negative.`);
        }
        if (safety < 0) {
            throw new ReplenishmentRuleValidationError(`Safety stock cannot be negative.`);
        }
    }
    /**
     * Evaluates demand forecasting reliability and categorizes edge cases.
     */
    static evaluateDemandForecast(params) {
        const { productCreatedAt, analysisPeriodDays, daysWithSales, totalNetSalesScaled, averageDailyDemandScaled, maxSingleDaySaleScaled } = params;
        const flags = [];
        // Check product age (new product < 14 days)
        const productAgeDays = Math.floor((Date.now() - new Date(productCreatedAt).getTime()) / (1000 * 60 * 60 * 24));
        if (productAgeDays < 14) {
            flags.push('NEW_PRODUCT_LOW_HISTORY');
        }
        // Zero sales
        if (totalNetSalesScaled <= 0) {
            flags.push('ZERO_SALES');
            return { confidence: flags.includes('NEW_PRODUCT_LOW_HISTORY') ? 'LOW' : 'MEDIUM', flags };
        }
        // Outlier / Promotional spike detection: single day > 3x average
        if (averageDailyDemandScaled > 0 && maxSingleDaySaleScaled > averageDailyDemandScaled * 3) {
            flags.push('PROMOTION_SPIKE_DETECTED');
        }
        // Sparse sales (sold on fewer than 20% of days in period)
        const saleDaysRatio = daysWithSales / Math.max(1, analysisPeriodDays);
        if (saleDaysRatio < 0.2) {
            flags.push('IRREGULAR_DEMAND');
        }
        let confidence = 'HIGH';
        if (flags.includes('NEW_PRODUCT_LOW_HISTORY') || flags.includes('IRREGULAR_DEMAND')) {
            confidence = 'LOW';
        }
        else if (flags.includes('PROMOTION_SPIKE_DETECTED')) {
            confidence = 'MEDIUM';
        }
        return { confidence, flags };
    }
    /**
     * Validates supplier status before converting replenishment suggestions to Purchase Order.
     */
    static validateSupplierForConversion(supplier) {
        if (!supplier.isActive) {
            throw new InactiveSupplierReplenishmentError(supplier.name);
        }
    }
}
exports.ReplenishmentRules = ReplenishmentRules;
