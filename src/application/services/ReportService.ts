import { SaleRepository } from '../../infrastructure/sqlite/repositories/SaleRepository';
import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { CustomerRepository } from '../../infrastructure/sqlite/repositories/CustomerRepository';
import { ExpenseRepository } from '../../infrastructure/sqlite/repositories/ExpenseRepository';
import { ProfitCalculator, ProfitAnalysis } from '../../domain/costing/profit-calculator';
import { DailyZReport } from '../../shared/types';

export class ReportService {
  constructor(
    private saleRepo: SaleRepository = new SaleRepository(),
    private productRepo: ProductRepository = new ProductRepository(),
    private customerRepo: CustomerRepository = new CustomerRepository(),
    private expenseRepo: ExpenseRepository = new ExpenseRepository()
  ) {}

  public getDashboardStats(): any {
    const today = new Date().toISOString().slice(0, 10);
    const summary = this.saleRepo.getDailySummary(today);
    const lowStock = this.productRepo.listLowStock();
    const customers = this.customerRepo.list();
    const totalReceivables = customers.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);

    return {
      todaySalesAmount: summary.grandTotal || 0,
      todayOrdersCount: summary.count || 0,
      todayProfit: summary.totalProfit || 0,
      lowStockCount: lowStock.length,
      totalCustomerReceivables: totalReceivables
    };
  }

  public getDailyZReport(dateString?: string): DailyZReport {
    const targetDate = dateString || new Date().toISOString().slice(0, 10);
    const summary = this.saleRepo.getDailySummary(targetDate);
    const dailyExpenses = this.expenseRepo.getDailyExpenses(targetDate);

    const netSales = (summary.grossSales || 0) - (summary.totalDiscounts || 0);
    const grossProfit = netSales - (summary.totalCost || 0);
    const netProfit = grossProfit - dailyExpenses;

    return {
      date: targetDate,
      generatedAt: new Date().toISOString(),
      totalSalesCount: summary.count || 0,
      grossSales: summary.grossSales || 0,
      totalDiscounts: summary.totalDiscounts || 0,
      netSales,
      totalTax: summary.totalTax || 0,
      grandTotal: summary.grandTotal || 0,
      totalCostOfGoodsSold: summary.totalCost || 0,
      grossProfit,
      totalExpenses: dailyExpenses,
      netProfit,
      cashInDrawer: summary.cashCollected || 0,
      cardPayments: summary.cardCollected || 0,
      customerCreditSales: summary.creditExtended || 0,
      customerCreditPaymentsReceived: 0
    };
  }

  public getProfitLossReport(dateString?: string): ProfitAnalysis {
    const targetDate = dateString || new Date().toISOString().slice(0, 10);
    const summary = this.saleRepo.getDailySummary(targetDate);
    const expenses = this.expenseRepo.getDailyExpenses(targetDate);

    return ProfitCalculator.calculateProfitSummary({
      grossSales: summary.grossSales || 0,
      discounts: summary.totalDiscounts || 0,
      costOfGoodsSold: summary.totalCost || 0,
      operatingExpenses: expenses
    });
  }

  public getStockValuationReport(): {
    totalItems: number;
    totalStockUnits: number;
    totalCostValuation: number;
    totalRetailValuation: number;
    potentialProfit: number;
  } {
    const products = this.productRepo.list();
    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;

    for (const p of products) {
      if (p.currentStock > 0) {
        totalStockUnits += p.currentStock;
        totalCostValuation += Math.round(p.currentStock * p.costPrice);
        totalRetailValuation += Math.round(p.currentStock * p.sellingPrice);
      }
    }

    return {
      totalItems: products.length,
      totalStockUnits: Math.round(totalStockUnits * 100) / 100,
      totalCostValuation,
      totalRetailValuation,
      potentialProfit: totalRetailValuation - totalCostValuation
    };
  }
}

