import React, { useState, useEffect } from 'react';
import { DailyZReport } from '../../../shared/types';
import { BarChart3, FileText, TrendingUp, Boxes, RefreshCw, Printer } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const [activeReport, setActiveReport] = useState<'z-report' | 'pl' | 'valuation'>('z-report');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [zReport, setZReport] = useState<DailyZReport | null>(null);
  const [plReport, setPlReport] = useState<any | null>(null);
  const [valuationReport, setValuationReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    try {
      setLoading(true);
      if (window.posApi?.reports) {
        if (activeReport === 'z-report') {
          const data = await window.posApi.reports.getDailyZReport(selectedDate);
          setZReport(data);
        } else if (activeReport === 'pl') {
          const data = await window.posApi.reports.getProfitLossReport(selectedDate);
          setPlReport(data);
        } else if (activeReport === 'valuation') {
          const data = await window.posApi.reports.getStockValuationReport();
          setValuationReport(data);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [activeReport, selectedDate]);

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Financial & Operational Reports</h1>
          <p className="text-xs text-slate-400">Daily Register Z-Closing, P&L Statement, and Inventory Valuation</p>
        </div>

        <div className="flex items-center gap-3">
          {activeReport !== 'valuation' && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
            />
          )}

          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
            <button
              onClick={() => setActiveReport('z-report')}
              className={`px-3 py-1.5 rounded-lg transition ${activeReport === 'z-report' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Daily Z-Report
            </button>
            <button
              onClick={() => setActiveReport('pl')}
              className={`px-3 py-1.5 rounded-lg transition ${activeReport === 'pl' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Profit & Loss
            </button>
            <button
              onClick={() => setActiveReport('valuation')}
              className={`px-3 py-1.5 rounded-lg transition ${activeReport === 'valuation' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Stock Valuation
            </button>
          </div>

          <button
            onClick={loadReport}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-4">
        {/* Z-Report view */}
        {activeReport === 'z-report' && zReport && (
          <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="text-center pb-4 border-b border-slate-800 mb-4">
              <h2 className="text-lg font-bold text-white tracking-wide">DAILY REGISTER CLOSING (Z-REPORT)</h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">Date: {zReport.date}</p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Total Invoices Issued:</span>
                <span className="font-mono font-bold text-white">{zReport.totalSalesCount}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Gross Sales Revenue:</span>
                <span className="font-mono text-white">{formatCents(zReport.grossSales)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-amber-400">
                <span>Total Discounts Given:</span>
                <span className="font-mono">-{formatCents(zReport.totalDiscounts)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Net Sales:</span>
                <span className="font-mono font-bold text-white">{formatCents(zReport.netSales)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Sales Tax Collected:</span>
                <span className="font-mono text-white">{formatCents(zReport.totalTax)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-slate-300">
                <span>Cost of Goods Sold (COGS):</span>
                <span className="font-mono text-rose-400">-{formatCents(zReport.totalCostOfGoodsSold)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60 font-bold text-emerald-400">
                <span>Gross Profit:</span>
                <span className="font-mono">{formatCents(zReport.grossProfit)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-slate-300">
                <span>Daily Operating Expenses:</span>
                <span className="font-mono text-rose-400">-{formatCents(zReport.totalExpenses)}</span>
              </div>
              <div className="flex justify-between py-2 border-b-2 border-slate-700 font-bold text-sm">
                <span className="text-white">NET STORE PROFIT:</span>
                <span className="font-mono text-emerald-400">{formatCents(zReport.netProfit)}</span>
              </div>

              {/* Cash Reconciliation */}
              <div className="mt-4 pt-2">
                <div className="text-slate-400 font-bold text-[11px] uppercase tracking-wider mb-2">Drawer Settlement</div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cash in Drawer (Physical):</span>
                    <span className="font-mono font-bold text-white">{formatCents(zReport.cashInDrawer)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Card Transactions:</span>
                    <span className="font-mono text-white">{formatCents(zReport.cardPayments)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Customer Credit Sales:</span>
                    <span className="font-mono text-amber-400">{formatCents(zReport.customerCreditSales)}</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              className="w-full mt-6 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition"
            >
              <Printer className="w-4 h-4" /> Print Z-Report
            </button>
          </div>
        )}

        {/* Profit & Loss View */}
        {activeReport === 'pl' && plReport && (
          <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-base font-bold text-white mb-1">Income & Expenditure Statement (P&L)</h2>
            <p className="text-xs text-slate-400 mb-5">Accounting Period: {selectedDate}</p>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-white uppercase tracking-wider text-[11px] mb-2">1. Operating Revenue</div>
                <div className="flex justify-between text-slate-300">
                  <span>Gross Sales</span>
                  <span className="font-mono">{formatCents(plReport.grossSales)}</span>
                </div>
                <div className="flex justify-between text-amber-400">
                  <span>Less: Discounts Allowed</span>
                  <span className="font-mono">-{formatCents(plReport.discounts)}</span>
                </div>
                <div className="flex justify-between font-bold text-white pt-2 border-t border-slate-800">
                  <span>Net Sales Revenue</span>
                  <span className="font-mono">{formatCents(plReport.netSales)}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-white uppercase tracking-wider text-[11px] mb-2">2. Cost of Sales</div>
                <div className="flex justify-between text-slate-300">
                  <span>Cost of Goods Sold (Inventory Outflow)</span>
                  <span className="font-mono text-rose-400">-{formatCents(plReport.costOfGoodsSold)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-400 pt-2 border-t border-slate-800">
                  <span>Gross Operating Profit</span>
                  <span className="font-mono">{formatCents(plReport.grossProfit)} ({plReport.grossProfitMarginPercent}%)</span>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-white uppercase tracking-wider text-[11px] mb-2">3. Operating Overheads</div>
                <div className="flex justify-between text-slate-300">
                  <span>Total Operating Expenses (Rent, Utilities, Staff)</span>
                  <span className="font-mono text-rose-400">-{formatCents(plReport.operatingExpenses)}</span>
                </div>
              </div>

              <div className="p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-xl flex justify-between items-center text-sm font-bold">
                <span className="text-white">NET PROFIT BEFORE TAX:</span>
                <span className="font-mono text-emerald-400 text-lg">
                  {formatCents(plReport.netProfit)} ({plReport.netProfitMarginPercent}%)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Stock Valuation View */}
        {activeReport === 'valuation' && valuationReport && (
          <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-base font-bold text-white mb-1">Inventory Valuation Summary</h2>
            <p className="text-xs text-slate-400 mb-5">Asset value computed from active stock levels and cost prices</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 mb-1">Total Active SKUs</div>
                <div className="text-2xl font-bold font-mono text-white">{valuationReport.totalItems}</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 mb-1">Total Physical Units in Stock</div>
                <div className="text-2xl font-bold font-mono text-white">{valuationReport.totalStockUnits}</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 mb-1">Total Asset Value at Cost (Asset 1040)</div>
                <div className="text-2xl font-bold font-mono text-blue-400">{formatCents(valuationReport.totalCostValuation)}</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 mb-1">Estimated Retail Realization</div>
                <div className="text-2xl font-bold font-mono text-emerald-400">{formatCents(valuationReport.totalRetailValuation)}</div>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400 font-semibold">Projected Unrealized Gross Margin:</span>
              <span className="font-mono font-bold text-white text-base">
                {formatCents(valuationReport.potentialProfit)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

