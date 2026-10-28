import React, { useState, useEffect } from 'react';
import { DollarSign, ShoppingBag, AlertTriangle, Users, TrendingUp, RefreshCw } from 'lucide-react';

export const DashboardPage: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [stats, setStats] = useState({
    todaySalesAmount: 0,
    todayOrdersCount: 0,
    todayProfit: 0,
    lowStockCount: 0,
    totalCustomerReceivables: 0
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      if (window.posApi?.reports) {
        const data = await window.posApi.reports.getDashboardStats();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatCurrency = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Store Overview & Operations</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time local POS performance metrics</p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl border border-slate-700 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {/* Today's Sales */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Today's Sales</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {formatCurrency(stats.todaySalesAmount)}
          </div>
          <div className="text-xs text-slate-400">
            {stats.todayOrdersCount} completed transactions today
          </div>
        </div>

        {/* Estimated Profit */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Profit</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {formatCurrency(stats.todayProfit)}
          </div>
          <div className="text-xs text-slate-400">
            Based on FIFO & moving cost valuation
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div
          onClick={() => onNavigate('inventory')}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm cursor-pointer hover:border-amber-500/40 transition"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Low Stock Alerts</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-400 mb-1">
            {stats.lowStockCount}
          </div>
          <div className="text-xs text-slate-400">
            Items below minimum safety threshold
          </div>
        </div>

        {/* Customer Receivables */}
        <div
          onClick={() => onNavigate('customers')}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm cursor-pointer hover:border-purple-500/40 transition"
        >
          <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Customer Dues</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {formatCurrency(stats.totalCustomerReceivables)}
          </div>
          <div className="text-xs text-slate-400">
            Total credit outstanding from customers
          </div>
        </div>
      </div>

      {/* Quick Launch Buttons */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-base font-bold text-white mb-4">Quick POS Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button
            onClick={() => onNavigate('sales')}
            className="flex items-center gap-3 p-4 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-xl text-left transition"
          >
            <ShoppingBag className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-semibold text-sm text-white">Open Cash Register</div>
              <div className="text-xs text-slate-400">Barcode checkout (F1)</div>
            </div>
          </button>

          <button
            onClick={() => onNavigate('inventory')}
            className="flex items-center gap-3 p-4 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-xl text-left transition"
          >
            <ShoppingBag className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-semibold text-sm text-white">Manage Products</div>
              <div className="text-xs text-slate-400">Stock & Price adjustments</div>
            </div>
          </button>

          <button
            onClick={() => onNavigate('reports')}
            className="flex items-center gap-3 p-4 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 rounded-xl text-left transition"
          >
            <TrendingUp className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-semibold text-sm text-white">Daily Z-Report</div>
              <div className="text-xs text-slate-400">End of day register close</div>
            </div>
          </button>

          <button
            onClick={() => onNavigate('settings')}
            className="flex items-center gap-3 p-4 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 rounded-xl text-left transition"
          >
            <RefreshCw className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-semibold text-sm text-white">Backup Database</div>
              <div className="text-xs text-slate-400">Safe offline SQLite copy</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

