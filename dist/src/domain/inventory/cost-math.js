"use strict";
/**
 * Exact Cost Mathematics & Precision Utility
 *
 * Enforces integer minor currency units (paisa/cents) and scaled integer quantities.
 * Strictly prevents floating-point inaccuracies as the source of truth.
 * Implements exact rational math, financial rounding policies, and remainder allocation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExactCostMath = void 0;
class ExactCostMath {
    static QUANTITY_SCALE = 1000n; // 1 unit = 1000 scaled
    static CURRENCY_DECIMALS = 2; // 1 PKR = 100 paisa
    /**
     * Converts a user-facing decimal quantity (e.g. 2.5) to scaled bigint (2500n).
     */
    static toScaledQuantity(quantity) {
        return BigInt(Math.round(quantity * Number(this.QUANTITY_SCALE)));
    }
    /**
     * Converts a scaled bigint quantity (e.g. 2500n) to decimal number (2.5).
     */
    static fromScaledQuantity(scaled) {
        return Number(scaled) / Number(this.QUANTITY_SCALE);
    }
    /**
     * Financial division with defined rounding policy.
     * Calculates round(numerator / denominator) in exact integer arithmetic.
     */
    static divideAndRound(numerator, denominator, policy = 'HALF_UP') {
        if (denominator === 0n) {
            throw new Error('Division by zero in cost arithmetic.');
        }
        const isNegative = (numerator < 0n) !== (denominator < 0n);
        const absNum = numerator < 0n ? -numerator : numerator;
        const absDen = denominator < 0n ? -denominator : denominator;
        const quotient = absNum / absDen;
        const remainder = absNum % absDen;
        let roundUp = false;
        const doubleRemainder = remainder * 2n;
        if (policy === 'HALF_UP') {
            roundUp = doubleRemainder >= absDen;
        }
        else {
            // HALF_EVEN (Banker's rounding)
            if (doubleRemainder > absDen) {
                roundUp = true;
            }
            else if (doubleRemainder === absDen) {
                // Exactly half: round to nearest even quotient
                roundUp = quotient % 2n === 1n;
            }
        }
        const finalAbs = roundUp ? quotient + 1n : quotient;
        return isNegative ? -finalAbs : finalAbs;
    }
    /**
     * Calculates total line cost from unit cost minor and scaled quantity:
     * totalCostMinor = round((quantityScaled * unitCostMinor) / QUANTITY_SCALE)
     */
    static calculateTotalCostMinor(quantityScaled, unitCostMinor, policy = 'HALF_UP') {
        const q = BigInt(quantityScaled);
        const c = BigInt(unitCostMinor);
        const total = this.divideAndRound(q * c, this.QUANTITY_SCALE, policy);
        return Number(total);
    }
    /**
     * Calculates unit cost minor from total cost minor and scaled quantity:
     * unitCostMinor = round((totalCostMinor * QUANTITY_SCALE) / quantityScaled)
     */
    static calculateUnitCostMinor(totalCostMinor, quantityScaled, policy = 'HALF_UP') {
        const t = BigInt(totalCostMinor);
        const q = BigInt(quantityScaled);
        if (q === 0n)
            return 0;
        const unit = this.divideAndRound(t * this.QUANTITY_SCALE, q, policy);
        return Number(unit);
    }
    /**
     * Calculates exact new weighted average balance:
     * NewValue = OldValue + ReceiptValue
     * NewQuantity = OldQuantity + ReceivedQuantity
     * average_unit_cost_numerator = NewValue
     * average_unit_cost_denominator = NewQuantity
     */
    static calculateWeightedAverage(params) {
        const oldQty = BigInt(params.oldQuantityScaled);
        const oldVal = BigInt(params.oldValueMinor);
        const recQty = BigInt(params.receivedQuantityScaled);
        const recVal = BigInt(params.receivedValueMinor);
        const newQty = oldQty + recQty;
        const newVal = oldVal + recVal;
        let unitCost = 0n;
        if (newQty > 0n) {
            unitCost = this.divideAndRound(newVal * this.QUANTITY_SCALE, newQty);
        }
        return {
            newQuantityScaled: Number(newQty),
            newValueMinor: Number(newVal),
            unitCostMinor: Number(unitCost),
            numerator: Number(newVal),
            denominator: Number(newQty)
        };
    }
    /**
     * Apportions an exact total integer minor amount among multiple shares using the
     * Largest Remainder Method (Hare-Niemeyer).
     *
     * Guaranteed property:
     * sum(allocatedAmounts) === totalMinor
     * Zero cents/paisa lost to rounding.
     */
    static allocateProportionally(totalMinor, weights) {
        if (weights.length === 0)
            return [];
        if (weights.length === 1)
            return [totalMinor];
        const totalWeight = weights.reduce((acc, w) => acc + w, 0);
        if (totalWeight <= 0) {
            // Equal split if all weights zero
            const base = Math.floor(totalMinor / weights.length);
            const remainder = totalMinor - base * weights.length;
            return weights.map((_, i) => (i < remainder ? base + 1 : base));
        }
        const totalBig = BigInt(totalMinor);
        const weightBigs = weights.map((w) => BigInt(Math.max(0, Math.round(w))));
        const sumWeightBig = weightBigs.reduce((acc, w) => acc + w, 0n);
        // Initial floor division and fraction tracking
        let allocatedSum = 0n;
        const results = [];
        for (let i = 0; i < weights.length; i++) {
            const prod = totalBig * weightBigs[i];
            const base = prod / sumWeightBig;
            const rem = prod % sumWeightBig;
            allocatedSum += base;
            results.push({ index: i, base, fractionRemainder: rem });
        }
        // Remainder to distribute 1 unit each
        let remainderToDistribute = totalBig - allocatedSum;
        // Sort descending by fractional remainder
        const sorted = [...results].sort((a, b) => {
            if (b.fractionRemainder > a.fractionRemainder)
                return 1;
            if (b.fractionRemainder < a.fractionRemainder)
                return -1;
            return a.index - b.index;
        });
        const finalAllocations = new Array(weights.length).fill(0n);
        for (const item of results) {
            finalAllocations[item.index] = item.base;
        }
        for (let i = 0; i < Number(remainderToDistribute); i++) {
            finalAllocations[sorted[i].index] += 1n;
        }
        return finalAllocations.map((v) => Number(v));
    }
}
exports.ExactCostMath = ExactCostMath;
