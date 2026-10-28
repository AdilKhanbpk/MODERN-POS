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

import { QUANTITY_SCALE, fromScaledQuantity, toScaledQuantity } from '../units/scaled-quantity';

export interface MovingAverageInput {
  currentStockQty: number; // in base units
  currentUnitCostMinor: number;
  receivedQty: number; // in base units
  purchaseUnitCostMinor: number;
}

export interface GrossProfitReportLine {
  productId: number;
  productName: string;
  sku: string;
  quantitySold: number;
  grossRevenueMinor: number;
  discountsMinor: number;
  taxCollectedMinor: number;
  netRevenueExcludingTaxMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginPercent: number;
}

export interface OperatingProfitStatement {
  periodStart?: string;
  periodEnd?: string;
  grossSalesMinor: number;
  discountsMinor: number;
  taxCollectedMinor: number;
  netSalesExcludingTaxMinor: number;
  costOfGoodsSoldMinor: number;
  grossProfitMinor: number;
  grossMarginPercent: number;

  operatingExpensesMinor: number;
  expensesByCategory: Array<{
    categoryName: string;
    amountMinor: number;
  }>;

  operatingProfitMinor: number;
  operatingMarginPercent: number;
}

export class MovingAverageCostCalculator {
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
  public static calculateNewAverageCost(params: MovingAverageInput): number {
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
  public static calculateNewAverageCostScaled(params: {
    currentStockScaled: number;
    currentUnitCostMinor: number;
    receivedScaled: number;
    purchaseUnitCostMinor: number;
  }): number {
    const currentQty = fromScaledQuantity(params.currentStockScaled);
    const receivedQty = fromScaledQuantity(params.receivedScaled);
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
  public static calculateSaleMargin(params: {
    quantity: number;
    salePriceMinor: number;
    unitCostMinor: number;
    taxRate?: number;
    isTaxInclusive?: boolean;
    discountMinor?: number;
  }): {
    grossRevenueMinor: number;
    taxAmountMinor: number;
    netRevenueExcludingTaxMinor: number;
    cogsMinor: number;
    grossProfitMinor: number;
    grossMarginPercent: number;
  } {
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
      } else {
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
  public static generateOperatingProfitStatement(params: {
    grossSalesMinor: number;
    discountsMinor: number;
    taxCollectedMinor: number;
    costOfGoodsSoldMinor: number;
    expenses: Array<{ categoryName: string; amountMinor: number }>;
    periodStart?: string;
    periodEnd?: string;
  }): OperatingProfitStatement {
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

