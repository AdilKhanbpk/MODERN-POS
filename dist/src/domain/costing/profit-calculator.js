"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfitCalculator = void 0;
__exportStar(require("./moving-average"), exports);
class ProfitCalculator {
    /**
     * Calculates Gross Profit, Net Profit, and operational profit margins.
     */
    static calculateProfitSummary(params) {
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
exports.ProfitCalculator = ProfitCalculator;
