"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LandedCostCalculator = exports.IneligibleLandedCostError = void 0;
const cost_math_1 = require("../inventory/cost-math");
class IneligibleLandedCostError extends Error {
    constructor(category) {
        super(`Operating expense "${category}" cannot be capitalized into inventory value. Only direct inventoriable acquisition costs (freight, customs, import tariffs, handling, shipping insurance) are allowed.`);
        this.name = 'IneligibleLandedCostError';
        Object.setPrototypeOf(this, IneligibleLandedCostError.prototype);
    }
}
exports.IneligibleLandedCostError = IneligibleLandedCostError;
class LandedCostCalculator {
    // Permitted inventoriable landed cost expense categories
    static ELIGIBLE_CATEGORIES = new Set([
        'freight',
        'shipping',
        'transportation',
        'customs',
        'customs_duty',
        'tariff',
        'import_duty',
        'handling',
        'port_charges',
        'demurrage',
        'insurance',
        'shipping_insurance',
        'clearance',
        'landing'
    ]);
    /**
     * Validates whether an expense category is an eligible inventoriable landed cost.
     * Prohibits general operating expenses (rent, marketing, salaries, utilities, tea).
     */
    static validateExpenseCategory(category) {
        if (!category)
            return;
        const normalized = category.toLowerCase().trim().replace(/[\s-]+/g, '_');
        if (!this.ELIGIBLE_CATEGORIES.has(normalized)) {
            throw new IneligibleLandedCostError(category);
        }
    }
    /**
     * Comprehensive Landed Cost Allocation Engine supporting 4 configured methods:
     * 1. BY_QUANTITY: Proportionate to item quantity
     * 2. BY_WEIGHT: Proportionate to item physical weight
     * 3. BY_VALUE: Proportionate to line item purchase value
     * 4. MANUAL: Direct user-specified allocation
     *
     * Exact integer remainder distribution guaranteed via Hare-Niemeyer method.
     */
    static allocateLandedCosts(input) {
        const { allocationMethod, totalAdditionalCostMinor, expenseCategory, items } = input;
        // Validate expense category eligibility
        this.validateExpenseCategory(expenseCategory);
        if (items.length === 0) {
            return {
                allocationMethod,
                totalAdditionalCostMinor,
                totalAllocatedMinor: 0,
                lines: []
            };
        }
        if (totalAdditionalCostMinor === 0) {
            return {
                allocationMethod,
                totalAdditionalCostMinor: 0,
                totalAllocatedMinor: 0,
                lines: items.map((item) => {
                    const qty = item.quantityScaled / 1000;
                    return {
                        productId: item.productId,
                        baseCostMinor: item.baseCostMinor,
                        allocatedAdditionalCostMinor: 0,
                        effectiveUnitCostMinor: qty > 0 ? Math.round(item.baseCostMinor / qty) : 0,
                        totalLandedCostMinor: item.baseCostMinor
                    };
                })
            };
        }
        let allocatedCosts = [];
        switch (allocationMethod) {
            case 'quantity': {
                const weights = items.map((item) => item.quantityScaled);
                allocatedCosts = cost_math_1.ExactCostMath.allocateProportionally(totalAdditionalCostMinor, weights);
                break;
            }
            case 'weight': {
                const weights = items.map((item) => {
                    const grams = item.weightGrams || 1000; // default 1kg if unstated
                    return Math.round((item.quantityScaled / 1000) * grams);
                });
                allocatedCosts = cost_math_1.ExactCostMath.allocateProportionally(totalAdditionalCostMinor, weights);
                break;
            }
            case 'value': {
                const weights = items.map((item) => item.baseCostMinor);
                allocatedCosts = cost_math_1.ExactCostMath.allocateProportionally(totalAdditionalCostMinor, weights);
                break;
            }
            case 'manual': {
                // User directly specifies manualCostMinor per item
                let sumManual = 0;
                allocatedCosts = items.map((item) => {
                    const m = item.manualCostMinor || 0;
                    sumManual += m;
                    return m;
                });
                // Absorb difference on last line if manual amounts don't exactly match
                const diff = totalAdditionalCostMinor - sumManual;
                if (diff !== 0 && allocatedCosts.length > 0) {
                    allocatedCosts[allocatedCosts.length - 1] += diff;
                }
                break;
            }
            default: {
                // Default to value-based
                const weights = items.map((item) => item.baseCostMinor);
                allocatedCosts = cost_math_1.ExactCostMath.allocateProportionally(totalAdditionalCostMinor, weights);
                break;
            }
        }
        const totalAllocatedMinor = allocatedCosts.reduce((a, b) => a + b, 0);
        const lines = items.map((item, idx) => {
            const allocatedAdd = allocatedCosts[idx];
            const totalLandedCost = item.baseCostMinor + allocatedAdd;
            const qty = item.quantityScaled / 1000;
            const effectiveUnitCostMinor = qty > 0 ? Math.round(totalLandedCost / qty) : 0;
            return {
                productId: item.productId,
                baseCostMinor: item.baseCostMinor,
                allocatedAdditionalCostMinor: allocatedAdd,
                effectiveUnitCostMinor,
                totalLandedCostMinor: totalLandedCost
            };
        });
        return {
            allocationMethod,
            totalAdditionalCostMinor,
            totalAllocatedMinor,
            lines
        };
    }
    /**
     * Backward-compatible helper for legacy PurchaseService calls.
     */
    static calculateLandedCosts(items, additionalCostCents) {
        const landedItems = items.map((item) => ({
            productId: item.productId,
            quantityScaled: Math.round(item.quantity * (item.conversionFactor || 1) * 1000),
            baseCostMinor: item.quantity * item.unitCostPrice
        }));
        const result = this.allocateLandedCosts({
            businessId: '00000000-0000-0000-0000-000000000001',
            allocationMethod: 'value',
            totalAdditionalCostMinor: additionalCostCents,
            expenseCategory: 'freight',
            items: landedItems
        });
        return items.map((item, idx) => {
            const line = result.lines[idx];
            return {
                productId: item.productId,
                unitCostBeforeLanded: item.unitCostPrice,
                apportionedAdditionalCost: line.allocatedAdditionalCostMinor,
                effectiveUnitCost: line.effectiveUnitCostMinor,
                totalLineCost: line.totalLandedCostMinor
            };
        });
    }
}
exports.LandedCostCalculator = LandedCostCalculator;
