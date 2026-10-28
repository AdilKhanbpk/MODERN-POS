"use strict";
/**
 * Domain: Moving Weighted-Average Cost (MAC) & Retail Profit
 * Implements moving-average inventory valuation, gross profit vs operating profit separation,
 * and immutable historical cost snapshots.
 *
 * Formula:
 *   New Cost = round(
 *     ((Current Qty * Current Cost) + (Received Qty * Purchase Cost)) / (Current Qty + Received Qty)
 *   )
 *
 * Accounting Treatment of Sales Tax:
 *   Sales tax collected is a fiduciary liability owed to the revenue authority.
 *   It is STRICTLY EXCLUDED from commercial sales revenue when calculating Gross Profit.
 *
 * Invariant Rule:
 *   Historical sale cost snapshots (sale_lines.unit_cost_minor) are permanently immutable.
 *   Updating the product's moving-average cost in inventory NEVER rewrites historical sales.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovingAverageCostCalculator = void 0;
const scaled_quantity_1 = require("../units/scaled-quantity");
class MovingAverageCostCalculator {
    /**
     * Calculates the new moving weighted-average cost per base unit upon receipt of new stock.
     *
     * Example from specifications:
     *   Old stock: 10 pieces @ Rs 100 (10,000 paisa) = Rs 1,000 (100,000 paisa)
     *   New purchase: 10 pieces @ Rs 120 (12,000 paisa) = Rs 1,200 (120,000 paisa)
     *   Total stock: 20 pieces
     *   Total cost: Rs 2,200 (220,000 paisa)
     *   Weighted-average cost: Rs 110 (11,000 paisa) per piece
     */
    static calculateNewAverageCost(params) {
        const { currentStockQty, currentUnitCostMinor, receivedQty, purchaseUnitCostMinor } = params;
        if (receivedQty <= 0) {
            return Math.round(currentUnitCostMinor);
        }
        // If current inventory is zero or negative (e.g. backorders), intake price becomes the new base cost
        if (currentStockQty <= 0) {
            return Math.round(purchaseUnitCostMinor);
        }
        const currentStockVal = currentStockQty * currentUnitCostMinor;
        const receivedVal = receivedQty * purchaseUnitCostMinor;
        const totalQty = currentStockQty + receivedQty;
        if (totalQty <= 0) {
            return Math.round(purchaseUnitCostMinor);
        }
        return Math.round((currentStockVal + receivedVal) / totalQty);
    }
    /**
     * Calculates new average cost directly from fixed-point scaled quantities.
     */
    static calculateNewAverageCostScaled(params) {
        const currentQty = (0, scaled_quantity_1.fromScaledQuantity)(params.currentStockScaled);
        const receivedQty = (0, scaled_quantity_1.fromScaledQuantity)(params.receivedScaled);
        return this.calculateNewAverageCost({
            currentStockQty: currentQty,
            currentUnitCostMinor: params.currentUnitCostMinor,
            receivedQty,
            purchaseUnitCostMinor: params.purchaseUnitCostMinor
        });
    }
    /**
     * Evaluates sale revenue, COGS, and gross profit for a sold line.
     *
     * Example:
     *   5 pieces sold @ Rs 150 = Rs 750 (75,000 paisa)
     *   COGS: 5 * Rs 110 = Rs 550 (55,000 paisa)
     *   Gross profit = Rs 200 (20,000 paisa)
     */
    static calculateSaleMargin(params) {
        const qty = params.quantity;
        const grossRevenue = Math.round(qty * params.salePriceMinor) - Math.round(params.discountMinor || 0);
        const taxRate = params.taxRate || 0;
        let taxAmount = 0;
        let netRevenueExcludingTax = grossRevenue;
        if (taxRate > 0) {
            if (params.isTaxInclusive) {
                const factor = 1 + taxRate / 100;
                netRevenueExcludingTax = Math.round(grossRevenue / factor);
                taxAmount = grossRevenue - netRevenueExcludingTax;
            }
            else {
                taxAmount = Math.round((grossRevenue * taxRate) / 100);
                netRevenueExcludingTax = grossRevenue; // In exclusive mode, grossRevenue is already before tax
            }
        }
        const cogs = Math.round(qty * params.unitCostMinor);
        const grossProfit = netRevenueExcludingTax - cogs;
        const grossMarginPercent = netRevenueExcludingTax > 0
            ? Math.round((grossProfit / netRevenueExcludingTax) * 10000) / 100
            : 0;
        return {
            grossRevenueMinor: grossRevenue,
            taxAmountMinor: taxAmount,
            netRevenueExcludingTaxMinor: netRevenueExcludingTax,
            cogsMinor: cogs,
            grossProfitMinor: grossProfit,
            grossMarginPercent
        };
    }
    /**
     * Generates a separate Operating Profit Statement that deducts operating expenses
     * from gross profit to determine true net operational performance.
     */
    static generateOperatingProfitStatement(params) {
        const netSales = Math.max(0, params.grossSalesMinor - params.discountsMinor);
        // Statutory sales tax is excluded from commercial revenue
        const netSalesExcludingTax = Math.max(0, netSales - params.taxCollectedMinor);
        const grossProfit = netSalesExcludingTax - params.costOfGoodsSoldMinor;
        const grossMarginPercent = netSalesExcludingTax > 0
            ? Math.round((grossProfit / netSalesExcludingTax) * 10000) / 100
            : 0;
        const operatingExpenses = params.expenses.reduce((acc, e) => acc + Math.round(e.amountMinor), 0);
        const operatingProfit = grossProfit - operatingExpenses;
        const operatingMarginPercent = netSalesExcludingTax > 0
            ? Math.round((operatingProfit / netSalesExcludingTax) * 10000) / 100
            : 0;
        return {
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
            grossSalesMinor: params.grossSalesMinor,
            discountsMinor: params.discountsMinor,
            taxCollectedMinor: params.taxCollectedMinor,
            netSalesExcludingTaxMinor: netSalesExcludingTax,
            costOfGoodsSoldMinor: params.costOfGoodsSoldMinor,
            grossProfitMinor: grossProfit,
            grossMarginPercent,
            operatingExpensesMinor: operatingExpenses,
            expensesByCategory: params.expenses,
            operatingProfitMinor: operatingProfit,
            operatingMarginPercent
        };
    }
}
exports.MovingAverageCostCalculator = MovingAverageCostCalculator;
