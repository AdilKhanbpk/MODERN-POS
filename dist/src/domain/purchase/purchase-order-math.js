"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseOrderMath = void 0;
class PurchaseOrderMath {
    /**
     * Calculates gross, net, tax, and line total for a purchase order line using exact minor units.
     * Quantity is scaled by 1000 (e.g. 10000 = 10.000 units).
     */
    static calculateLine(params) {
        const qtyUnits = params.orderedQuantityScaled / 1000;
        const grossLineAmountMinor = Math.round(qtyUnits * params.unitPriceMinor);
        const discountMinor = Math.max(0, params.lineDiscountMinor || 0);
        // Net cannot be negative from line discount
        const netLineAmountMinor = Math.max(0, grossLineAmountMinor - discountMinor);
        const taxRate = params.taxRatePercent || 0;
        const taxAmountMinor = Math.round((netLineAmountMinor * taxRate) / 100);
        const lineTotalMinor = netLineAmountMinor + taxAmountMinor;
        const num = params.conversionNumerator || 1;
        const den = params.conversionDenominator || 1;
        const baseQuantityScaled = Math.round((params.orderedQuantityScaled * num) / den);
        return {
            grossLineAmountMinor,
            netLineAmountMinor,
            taxAmountMinor,
            lineTotalMinor,
            baseQuantityScaled
        };
    }
    /**
     * Aggregates line totals, document-level discounts, shipping, and other charges.
     */
    static calculateOrderTotals(params) {
        let subtotalMinor = 0;
        let linesDiscountMinor = 0;
        let taxMinor = 0;
        for (const l of params.lines) {
            subtotalMinor += l.grossLineAmountMinor;
            linesDiscountMinor += l.lineDiscountMinor;
            taxMinor += l.taxAmountMinor;
        }
        const docDiscount = Math.max(0, params.documentDiscountMinor || 0);
        const totalDiscountMinor = linesDiscountMinor + docDiscount;
        const shippingMinor = Math.max(0, params.shippingMinor || 0);
        const otherChargesMinor = Math.max(0, params.otherChargesMinor || 0);
        const netBeforeCharges = Math.max(0, subtotalMinor - totalDiscountMinor);
        const totalMinor = netBeforeCharges + taxMinor + shippingMinor + otherChargesMinor;
        return {
            subtotalMinor,
            discountMinor: totalDiscountMinor,
            taxMinor,
            shippingMinor,
            otherChargesMinor,
            totalMinor
        };
    }
    /**
     * Evaluates over-delivery against configured business policy.
     * Returns whether over-delivery occurred, excess quantity, and whether it is permitted.
     */
    static evaluateOverDelivery(params) {
        const totalAfterReceipt = params.alreadyReceivedScaled + params.incomingScaled;
        if (totalAfterReceipt <= params.orderedScaled) {
            return { isOverDelivery: false, excessScaled: 0, isPermitted: true };
        }
        const excessScaled = totalAfterReceipt - params.orderedScaled;
        if (params.hasManagerApproval) {
            return { isOverDelivery: true, excessScaled, isPermitted: true };
        }
        if (params.policy === 'reject') {
            return {
                isOverDelivery: true,
                excessScaled,
                isPermitted: false,
                reason: `Over-delivery rejected: order quantity is ${params.orderedScaled / 1000}, but receipt would total ${totalAfterReceipt / 1000}. Policy strictly blocks excess.`
            };
        }
        if (params.policy === 'allow_tolerance') {
            const maxAllowedScaled = Math.round(params.orderedScaled * (1 + params.tolerancePercent / 100));
            if (totalAfterReceipt <= maxAllowedScaled) {
                return { isOverDelivery: true, excessScaled, isPermitted: true };
            }
            return {
                isOverDelivery: true,
                excessScaled,
                isPermitted: false,
                reason: `Over-delivery exceeds tolerance limit of ${params.tolerancePercent}% (${maxAllowedScaled / 1000} units). Total received would be ${totalAfterReceipt / 1000} units.`
            };
        }
        if (params.policy === 'require_approval') {
            return {
                isOverDelivery: true,
                excessScaled,
                isPermitted: false,
                reason: 'Over-delivery requires manager approval.'
            };
        }
        return { isOverDelivery: true, excessScaled, isPermitted: false };
    }
}
exports.PurchaseOrderMath = PurchaseOrderMath;
