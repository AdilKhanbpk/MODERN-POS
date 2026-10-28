"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LandedCostCalculator = void 0;
class LandedCostCalculator {
    /**
     * Apportions additional freight/customs charges proportionally to items based on purchase value.
     */
    static calculateLandedCosts(items, additionalCostCents) {
        const totalPurchaseCost = items.reduce((sum, item) => sum + (item.quantity * item.unitCostPrice), 0);
        let allocatedSum = 0;
        return items.map((item, index) => {
            const lineBaseTotal = item.quantity * item.unitCostPrice;
            let lineAdditionalCost = 0;
            if (totalPurchaseCost > 0 && additionalCostCents > 0) {
                if (index === items.length - 1) {
                    // Last item absorbs any rounding remainder
                    lineAdditionalCost = additionalCostCents - allocatedSum;
                }
                else {
                    lineAdditionalCost = Math.round((lineBaseTotal / totalPurchaseCost) * additionalCostCents);
                    allocatedSum += lineAdditionalCost;
                }
            }
            const totalLineCost = lineBaseTotal + lineAdditionalCost;
            const effectiveUnitCost = Math.round(totalLineCost / (item.quantity * item.conversionFactor));
            return {
                productId: item.productId,
                unitCostBeforeLanded: item.unitCostPrice,
                apportionedAdditionalCost: lineAdditionalCost,
                effectiveUnitCost,
                totalLineCost
            };
        });
    }
}
exports.LandedCostCalculator = LandedCostCalculator;
