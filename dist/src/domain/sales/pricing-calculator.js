"use strict";
/**
 * Domain: Pricing Calculator
 * Implements the single authoritative sales pricing, tax, and discount formula.
 *
 * Line Formula:
 *   1. Line Gross = round(quantity * unitPrice)
 *   2. Line Item Discount = min(Line Gross, round(Line Gross * discountPercent / 100) + discountAmount)
 *   3. Line Net Before Bill Discount = Line Gross - Line Item Discount
 *   4. Allocated Bill Discount = proportional share of bill discount, with integer remainder adjusted
 *   5. Line Net After Bill Discount = Line Net Before Bill Discount - Allocated Bill Discount
 *   6. Tax Calculation:
 *      - Exclusive: tax = round(Line Net After Bill Discount * taxRate / 100), lineTotal = net + tax
 *      - Inclusive: preTaxNet = round(Line Net After Bill Discount / (1 + taxRate / 100)),
 *                   tax = Line Net After Bill Discount - preTaxNet, lineTotal = Line Net After Bill Discount
 *   7. Line Cost = round((baseQuantityScaled / 10,000) * unitCost)
 *   8. Line Profit = (lineTotal - tax) - Line Cost (tax collected is excluded from revenue)
 *
 * Guarantees that sum(Allocated Bill Discounts) == Total Bill Discount exactly without losing a single paisa.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingCalculator = void 0;
const scaled_quantity_1 = require("../units/scaled-quantity");
class PricingCalculator {
    /**
     * Calculates complete sale figures according to the single authoritative retail formula.
     * Supports bill-level proportional discount allocation and generates frozen historical line snapshots.
     */
    static calculateSale(items, orderDiscountPercent = 0, orderDiscountAmountCents = 0) {
        let subtotalCents = 0;
        let totalItemDiscountCents = 0;
        // Step 1: Preliminary line gross and item discount calculations
        const preliminaryLines = items.map((item) => {
            const grossCents = Math.round(item.quantity * item.unitPrice);
            subtotalCents += grossCents;
            const percentDiscount = Math.round((grossCents * (item.discountPercent || 0)) / 100);
            const itemDiscountCents = Math.min(grossCents, percentDiscount + Math.round(item.discountAmount || 0));
            totalItemDiscountCents += itemDiscountCents;
            const netBeforeBillDiscount = grossCents - itemDiscountCents;
            return {
                item,
                grossCents,
                itemDiscountCents,
                netBeforeBillDiscount
            };
        });
        const netBeforeOrderDiscount = Math.max(0, subtotalCents - totalItemDiscountCents);
        // Step 2: Determine total bill-level discount
        const percentOrderDiscount = Math.round((netBeforeOrderDiscount * (orderDiscountPercent || 0)) / 100);
        const totalOrderDiscountCents = Math.min(netBeforeOrderDiscount, percentOrderDiscount + Math.round(orderDiscountAmountCents || 0));
        // Step 3: Proportionally apportion bill-level discount across items with exact integer remainder conservation
        const allocatedBillDiscounts = new Array(preliminaryLines.length).fill(0);
        if (totalOrderDiscountCents > 0 && netBeforeOrderDiscount > 0) {
            let allocatedSum = 0;
            for (let i = 0; i < preliminaryLines.length; i++) {
                const lineNet = preliminaryLines[i].netBeforeBillDiscount;
                if (i === preliminaryLines.length - 1) {
                    // Last item absorbs any integer rounding remainder
                    allocatedBillDiscounts[i] = Math.max(0, totalOrderDiscountCents - allocatedSum);
                }
                else {
                    const share = Math.round((lineNet / netBeforeOrderDiscount) * totalOrderDiscountCents);
                    allocatedBillDiscounts[i] = share;
                    allocatedSum += share;
                }
            }
        }
        // Step 4: Final line taxes, costs, totals, and profits
        let totalTaxCents = 0;
        let totalCostCents = 0;
        let grandTotalCents = 0;
        const calculatedItems = preliminaryLines.map((line, idx) => {
            const item = line.item;
            const allocatedBillDiscount = allocatedBillDiscounts[idx];
            const netAfterBillDiscount = Math.max(0, line.netBeforeBillDiscount - allocatedBillDiscount);
            let lineTaxCents = 0;
            let lineTotalCents = 0;
            const taxRate = item.taxRate || 0;
            if (taxRate > 0) {
                if (item.isTaxInclusive) {
                    // Inclusive: price includes tax
                    const factor = 1 + taxRate / 100;
                    const preTaxNet = Math.round(netAfterBillDiscount / factor);
                    lineTaxCents = netAfterBillDiscount - preTaxNet;
                    lineTotalCents = netAfterBillDiscount;
                }
                else {
                    // Exclusive: tax added on top of net
                    lineTaxCents = Math.round((netAfterBillDiscount * taxRate) / 100);
                    lineTotalCents = netAfterBillDiscount + lineTaxCents;
                }
            }
            else {
                lineTaxCents = 0;
                lineTotalCents = netAfterBillDiscount;
            }
            totalTaxCents += lineTaxCents;
            grandTotalCents += lineTotalCents;
            // Calculate cost based on canonical base units
            const conversionFactor = item.conversionFactor || 1;
            const baseQty = item.quantity * conversionFactor;
            const lineCostCents = Math.round(baseQty * (item.costPrice || 0));
            totalCostCents += lineCostCents;
            const revenueNetOfTax = item.isTaxInclusive
                ? lineTotalCents - lineTaxCents
                : netAfterBillDiscount;
            const lineProfitCents = revenueNetOfTax - lineCostCents;
            const totalLineDiscount = line.itemDiscountCents + allocatedBillDiscount;
            return {
                ...item,
                lineGross: line.grossCents,
                lineDiscount: totalLineDiscount,
                itemDiscount: line.itemDiscountCents,
                allocatedBillDiscount,
                lineNet: netAfterBillDiscount,
                lineTax: lineTaxCents,
                lineTotal: lineTotalCents,
                lineCostTotal: lineCostCents,
                lineProfit: lineProfitCents
            };
        });
        const totalDiscountCents = totalItemDiscountCents + totalOrderDiscountCents;
        const netTaxableAmountCents = Math.max(0, subtotalCents - totalDiscountCents);
        const estimatedProfitCents = (grandTotalCents - totalTaxCents) - totalCostCents;
        return {
            subtotal: subtotalCents,
            totalItemDiscount: totalItemDiscountCents,
            orderDiscountAmount: totalOrderDiscountCents,
            totalDiscount: totalDiscountCents,
            netTaxableAmount: netTaxableAmountCents,
            totalTax: totalTaxCents,
            grandTotal: grandTotalCents,
            totalCostPrice: totalCostCents,
            estimatedProfit: estimatedProfitCents,
            items: calculatedItems
        };
    }
    /**
     * Calculates a single authoritative sale line according to the exact specification formula.
     *
     * Example:
     *   Quantity: 3
     *   Unit price: Rs 100 (10,000 paisa)
     *   Gross line total: Rs 300 (30,000 paisa)
     *   Line discount: Rs 20 (2,000 paisa)
     *   Allocated bill discount: Rs 10 (1,000 paisa)
     *   Tax: Rs 0 (disabled)
     *   Final line total: Rs 270 (27,000 paisa)
     */
    static calculateAuthoritativeLine(params) {
        const qty = params.quantity;
        const unitPrice = Math.round(params.unitPriceMinor);
        const lineGross = Math.round(qty * unitPrice);
        const lineItemDiscount = Math.min(lineGross, Math.round(params.lineDiscountMinor || 0));
        const allocatedBillDiscount = Math.min(Math.max(0, lineGross - lineItemDiscount), Math.round(params.allocatedBillDiscountMinor || 0));
        const totalDiscount = lineItemDiscount + allocatedBillDiscount;
        const netAfterDiscounts = lineGross - totalDiscount;
        const taxRate = params.taxRate || 0;
        const isInclusive = !!params.isTaxInclusive;
        let taxAmount = 0;
        let lineTotal = 0;
        let preTaxRevenue = 0;
        if (taxRate > 0) {
            if (isInclusive) {
                const factor = 1 + taxRate / 100;
                preTaxRevenue = Math.round(netAfterDiscounts / factor);
                taxAmount = netAfterDiscounts - preTaxRevenue;
                lineTotal = netAfterDiscounts;
            }
            else {
                preTaxRevenue = netAfterDiscounts;
                taxAmount = Math.round((netAfterDiscounts * taxRate) / 100);
                lineTotal = netAfterDiscounts + taxAmount;
            }
        }
        else {
            preTaxRevenue = netAfterDiscounts;
            taxAmount = 0;
            lineTotal = netAfterDiscounts;
        }
        const num = params.conversionNumerator || 1;
        const den = params.conversionDenominator || 1;
        const quantityScaled = (0, scaled_quantity_1.toScaledQuantity)(qty);
        const baseQtyScaled = Math.round((quantityScaled * num) / den);
        const baseQtyDecimal = baseQtyScaled / scaled_quantity_1.QUANTITY_SCALE;
        const lineCost = Math.round(baseQtyDecimal * params.unitCostMinor);
        const lineProfit = preTaxRevenue - lineCost;
        return {
            productId: params.productId,
            variantId: params.variantId,
            productNameSnapshot: params.productName,
            skuSnapshot: params.sku,
            variantNameSnapshot: params.variantName,
            unitId: params.unitId,
            unitNameSnapshot: params.unitName,
            conversionNumeratorSnapshot: num,
            conversionDenominatorSnapshot: den,
            quantity: qty,
            quantityScaled,
            unitPriceMinor: unitPrice,
            lineGrossMinor: lineGross,
            lineItemDiscountMinor: lineItemDiscount,
            allocatedBillDiscountMinor: allocatedBillDiscount,
            totalLineDiscountMinor: totalDiscount,
            lineNetBeforeTaxMinor: preTaxRevenue,
            taxRate,
            isTaxInclusive: isInclusive,
            taxAmountMinor: taxAmount,
            lineTotalMinor: lineTotal,
            unitCostMinor: params.unitCostMinor,
            lineCostTotalMinor: lineCost,
            lineProfitMinor: lineProfit
        };
    }
    /**
     * Computes payment, customer balance change, and change to return.
     */
    static calculatePaymentSplit(grandTotalCents, amountPaidCents, isCreditSale = false) {
        if (amountPaidCents >= grandTotalCents) {
            return {
                changeGiven: amountPaidCents - grandTotalCents,
                customerBalanceChange: 0
            };
        }
        const remainingDue = grandTotalCents - amountPaidCents;
        if (isCreditSale) {
            return {
                changeGiven: 0,
                customerBalanceChange: remainingDue
            };
        }
        return {
            changeGiven: 0,
            customerBalanceChange: 0
        };
    }
}
exports.PricingCalculator = PricingCalculator;
