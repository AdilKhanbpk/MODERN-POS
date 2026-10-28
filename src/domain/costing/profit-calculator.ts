export * from './moving-average';

export interface ProfitAnalysis {
  grossSales: number;
  discounts: number;
  netSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  grossProfitMarginPercent: number;
  operatingExpenses: number;
  netProfit: number;
  netProfitMarginPercent: number;
}

export class ProfitCalculator {
  /**
   * Calculates Gross Profit, Net Profit, and operational profit margins.
   */
  public static calculateProfitSummary(params: {
    grossSales: number;
    discounts: number;
    costOfGoodsSold: number;
    operatingExpenses: number;
  }): ProfitAnalysis {
    const netSales = Math.max(0, params.grossSales - params.discounts);
    const grossProfit = netSales - params.costOfGoodsSold;
    const netProfit = grossProfit - params.operatingExpenses;

    const grossProfitMarginPercent = netSales > 0
      ? Math.round((grossProfit / netSales) * 10000) / 100
      : 0;

    const netProfitMarginPercent = netSales > 0
      ? Math.round((netProfit / netSales) * 10000) / 100
      : 0;

    return {
      grossSales: params.grossSales,
      discounts: params.discounts,
      netSales,
      costOfGoodsSold: params.costOfGoodsSold,
      grossProfit,
      grossProfitMarginPercent,
      operatingExpenses: params.operatingExpenses,
      netProfit,
      netProfitMarginPercent
    };
  }
}
