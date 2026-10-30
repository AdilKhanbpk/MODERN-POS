import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  FileText,
  Sliders,
  Warehouse,
  History,
  Lock,
  Unlock,
  AlertOctagon
} from 'lucide-react';
import {
  ProductBatch,
  ProductBatchSettings,
  BatchReportItem,
  BatchStatus,
  BatchSaleTraceItem
} from '../../../shared/types/batch-expiry';

export const BatchExpiryView: React.FC = () => {
  const [batches, setBatches] = useState<BatchReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'expiring' | 'expired' | 'quarantine' | 'recalled'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');

  // Modals
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTraceModalOpen, setIsTraceModalOpen] = useState(false);
  const [selectedBatchForTrace, setSelectedBatchForTrace] = useState<BatchReportItem | null>(null);
  const [traceSales, setTraceSales] = useState<BatchSaleTraceItem[]>([]);
  const [loadingTrace, setLoadingTrace] = useState(false);

  // Receive Form
  const [receiveForm, setReceiveForm] = useState({
    productId: '',
    stockLocationId: '',
    batchNumber: '',
    manufacturingDate: '',
    expiryDate: '',
    quantity: 1,
    unitCost: 0,
    notes: ''
  });

  // Settings Form
  const [settingsForm, setSettingsForm] = useState({
    productId: '',
    requiresBatch: true,
    requiresExpiry: true,
    expiryWarningDays: 30,
    expirySalePolicy: 'block' as 'block' | 'warn' | 'allow_authorized',
    batchCostPolicy: 'batch_specific' as 'batch_specific' | 'fifo' | 'average'
  });

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        // Load products & locations
        const [prodList, locList] = await Promise.all([
          window.posApi.inventory?.listProducts() || [],
          (window.posApi as any).stockLocations?.list(businessId) || []
        ]);
        setProducts(prodList || []);
        setLocations(locList || []);

        if (locList && locList.length > 0 && !receiveForm.stockLocationId) {
          setReceiveForm((prev) => ({ ...prev, stockLocationId: locList[0].id }));
        }

        // Load batch stock report
        const locId = selectedLocation !== 'all' ? selectedLocation : undefined;
        let reportData: BatchReportItem[] = [];
        if ((window.posApi as any).batchExpiry) {
          if (filterTab === 'expiring') {
            reportData = await (window.posApi as any).batchExpiry.reportExpiringSoon(businessId, 30, locId);
          } else if (filterTab === 'expired') {
            reportData = await (window.posApi as any).batchExpiry.reportExpired(businessId, locId);
          } else if (filterTab === 'recalled') {
            reportData = await (window.posApi as any).batchExpiry.reportRecalled(businessId);
          } else {
            reportData = await (window.posApi as any).batchExpiry.reportStock(businessId, locId);
            if (filterTab === 'quarantine') {
              reportData = reportData.filter((b) => b.status === 'quarantine');
            }
          }
        }
        setBatches(reportData || []);
      }
    } catch (err) {
      console.error('Failed to load batch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterTab, selectedLocation]);

  const handleReceiveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!receiveForm.productId || !receiveForm.batchNumber || !receiveForm.stockLocationId) {
        alert('Please fill in product, batch number, and stock location.');
        return;
      }

      await (window.posApi as any).batchExpiry.receiveBatch({
        businessId,
        branchId: '11111111-1111-1111-1111-111111111111',
        stockLocationId: receiveForm.stockLocationId,
        productId: receiveForm.productId,
        batchNumber: receiveForm.batchNumber,
        manufacturingDate: receiveForm.manufacturingDate || null,
        expiryDate: receiveForm.expiryDate || null,
        quantityScaled: Math.round(Number(receiveForm.quantity) * 1000),
        unitCostMinor: Math.round(Number(receiveForm.unitCost) * 100),
        notes: receiveForm.notes
      });

      setIsReceiveModalOpen(false);
      setReceiveForm({
        productId: '',
        stockLocationId: locations[0]?.id || '',
        batchNumber: '',
        manufacturingDate: '',
        expiryDate: '',
        quantity: 1,
        unitCost: 0,
        notes: ''
      });
      loadData();
    } catch (err: any) {
      alert(`Receipt Error: ${err.message}`);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!settingsForm.productId) {
        alert('Please select a product.');
        return;
      }

      await (window.posApi as any).batchExpiry.configureSettings({
        businessId,
        productId: settingsForm.productId,
        requiresBatch: settingsForm.requiresBatch,
        requiresExpiry: settingsForm.requiresExpiry,
        expiryWarningDays: Number(settingsForm.expiryWarningDays),
        expirySalePolicy: settingsForm.expirySalePolicy,
        batchCostPolicy: settingsForm.batchCostPolicy
      });

      setIsSettingsModalOpen(false);
      alert('Batch policy settings saved successfully.');
    } catch (err: any) {
      alert(`Error saving settings: ${err.message}`);
    }
  };

  const handleRecallBatch = async (batch: BatchReportItem) => {
    const reason = prompt(`Enter recall reason for batch "${batch.batchNumber}":`, 'Supplier safety advisory');
    if (!reason) return;

    try {
      const res = await (window.posApi as any).batchExpiry.recall({
        businessId,
        batchId: batch.batchId,
        reason
      });
      alert(`Batch "${batch.batchNumber}" has been RECALLED. Sales are immediately blocked. Affected past sales: ${res.affectedSales.length}. Remaining stock: ${res.remainingStockUnits} units.`);
      loadData();
    } catch (err: any) {
      alert(`Recall Error: ${err.message}`);
    }
  };

  const handleReleaseQuarantine = async (batch: BatchReportItem) => {
    if (!confirm(`Release batch "${batch.batchNumber}" from quarantine back to active inventory?`)) return;

    try {
      await (window.posApi as any).batchExpiry.releaseQuarantine(batch.batchId);
      alert(`Batch "${batch.batchNumber}" released to active stock.`);
      loadData();
    } catch (err: any) {
      alert(`Release Error: ${err.message}`);
    }
  };

  const handleOpenTrace = async (batch: BatchReportItem) => {
    setSelectedBatchForTrace(batch);
    setIsTraceModalOpen(true);
    setLoadingTrace(true);
    try {
      const sales = await (window.posApi as any).batchExpiry.traceSales(batch.batchId);
      setTraceSales(sales || []);
    } catch (err) {
      console.error('Failed to load trace:', err);
    } finally {
      setLoadingTrace(false);
    }
  };

  const filteredBatches = batches.filter((b) =>
    b.batchNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-white overflow-hidden p-6">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600/20 text-emerald-400 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Batch & Expiry Management</h1>
              <p className="text-xs text-slate-400">
                Perishable inventory tracking, FEFO automated stock rotation & pharmaceutical lot recalls
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
          >
            <Sliders className="w-4 h-4" /> Batch Policies
          </button>
          <button
            onClick={() => setIsReceiveModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-blue-600/20"
          >
            <Plus className="w-4 h-4" /> Receive Batch
          </button>
          <button
            onClick={loadData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs & Location Filter */}
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterTab === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            All Batches
          </button>
          <button
            onClick={() => setFilterTab('expiring')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterTab === 'expiring' ? 'bg-amber-600 text-white' : 'bg-slate-900 text-amber-400 hover:text-amber-300'
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> Expiring Soon (&le;30d)
          </button>
          <button
            onClick={() => setFilterTab('expired')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterTab === 'expired' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-rose-400 hover:text-rose-300'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Expired Stock
          </button>
          <button
            onClick={() => setFilterTab('quarantine')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterTab === 'quarantine' ? 'bg-purple-600 text-white' : 'bg-slate-900 text-purple-400 hover:text-purple-300'
            }`}
          >
            <Lock className="w-3.5 h-3.5" /> Quarantine
          </button>
          <button
            onClick={() => setFilterTab('recalled')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterTab === 'recalled' ? 'bg-red-700 text-white' : 'bg-slate-900 text-red-400 hover:text-red-300'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5" /> Recalled Batches
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2"
          >
            <option value="all">All Locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search batch or product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800 sticky top-0 backdrop-blur z-10">
            <tr>
              <th className="py-3 px-4">Batch Number</th>
              <th className="py-3 px-4">Product / SKU</th>
              <th className="py-3 px-4">Location</th>
              <th className="py-3 px-4">Available / On-Hand</th>
              <th className="py-3 px-4">Expiry Date</th>
              <th className="py-3 px-4">Days Left</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-500">
                  Loading batch records...
                </td>
              </tr>
            ) : filteredBatches.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-500">
                  No batch inventory matching the selected criteria.
                </td>
              </tr>
            ) : (
              filteredBatches.map((b) => {
                const isExpired = b.daysUntilExpiry !== null && b.daysUntilExpiry !== undefined && b.daysUntilExpiry < 0;
                const isExpiringToday = b.daysUntilExpiry === 0;
                const isExpiringSoon = b.daysUntilExpiry !== null && b.daysUntilExpiry !== undefined && b.daysUntilExpiry > 0 && b.daysUntilExpiry <= 30;

                return (
                  <tr key={b.batchId} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-medium text-white flex items-center gap-2">
                      {b.batchNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{b.productName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{b.sku}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{b.locationName}</td>
                    <td className="py-3 px-4 font-mono">
                      <span className="font-semibold text-emerald-400">{b.availableQuantity}</span>
                      <span className="text-slate-500 text-[11px]"> / {b.onHandQuantity} units</span>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {b.expiryDate ? b.expiryDate.slice(0, 10) : <span className="text-slate-500">No Expiry</span>}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {isExpired ? (
                        <span className="text-rose-400 font-semibold">{Math.abs(b.daysUntilExpiry!)}d ago (Expired)</span>
                      ) : isExpiringToday ? (
                        <span className="text-rose-400 font-semibold">Today</span>
                      ) : isExpiringSoon ? (
                        <span className="text-amber-400 font-semibold">{b.daysUntilExpiry}d left</span>
                      ) : b.daysUntilExpiry !== null && b.daysUntilExpiry !== undefined ? (
                        <span className="text-emerald-400">{b.daysUntilExpiry}d left</span>
                      ) : (
                        <span className="text-slate-500">&mdash;</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'active' && !isExpired && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          Active
                        </span>
                      )}
                      {b.status === 'quarantine' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-950 text-purple-400 border border-purple-800">
                          Quarantine
                        </span>
                      )}
                      {b.status === 'recalled' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-400 border border-red-800">
                          RECALLED
                        </span>
                      )}
                      {isExpired && b.status !== 'recalled' && b.status !== 'quarantine' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-400 border border-rose-800">
                          Expired
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenTrace(b)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-medium transition"
                        title="Trace Sales"
                      >
                        <History className="w-3.5 h-3.5 inline mr-1" /> Trace
                      </button>

                      {b.status === 'quarantine' && (
                        <button
                          onClick={() => handleReleaseQuarantine(b)}
                          className="px-2 py-1 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 rounded text-[11px] font-medium transition"
                          title="Release from quarantine"
                        >
                          <Unlock className="w-3.5 h-3.5 inline mr-1" /> Release
                        </button>
                      )}

                      {b.status === 'active' && (
                        <button
                          onClick={() => handleRecallBatch(b)}
                          className="px-2 py-1 bg-red-950 hover:bg-red-900 text-red-300 rounded text-[11px] font-medium transition"
                          title="Initiate recall"
                        >
                          <AlertOctagon className="w-3.5 h-3.5 inline mr-1" /> Recall
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Receive Modal */}
      {isReceiveModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Receive Batch Inventory</h2>
            <form onSubmit={handleReceiveBatch} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Product</label>
                <select
                  value={receiveForm.productId}
                  onChange={(e) => setReceiveForm({ ...receiveForm, productId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Stock Location</label>
                <select
                  value={receiveForm.stockLocationId}
                  onChange={(e) => setReceiveForm({ ...receiveForm, stockLocationId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Batch / Lot Number</label>
                <input
                  type="text"
                  placeholder="e.g. BATCH-2026-X01"
                  value={receiveForm.batchNumber}
                  onChange={(e) => setReceiveForm({ ...receiveForm, batchNumber: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Manufacturing Date</label>
                  <input
                    type="date"
                    value={receiveForm.manufacturingDate}
                    onChange={(e) => setReceiveForm({ ...receiveForm, manufacturingDate: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={receiveForm.expiryDate}
                    onChange={(e) => setReceiveForm({ ...receiveForm, expiryDate: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Received Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={receiveForm.quantity}
                    onChange={(e) => setReceiveForm({ ...receiveForm, quantity: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Unit Cost (Rs.)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={receiveForm.unitCost}
                    onChange={(e) => setReceiveForm({ ...receiveForm, unitCost: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-blue-600/20"
                >
                  Receive Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Configure Product Batch Policy</h2>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Product</label>
                <select
                  value={settingsForm.productId}
                  onChange={(e) => setSettingsForm({ ...settingsForm, productId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-6 p-3 bg-slate-800/40 rounded-xl border border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.requiresBatch}
                    onChange={(e) => setSettingsForm({ ...settingsForm, requiresBatch: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  Requires Batch Number
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.requiresExpiry}
                    onChange={(e) => setSettingsForm({ ...settingsForm, requiresExpiry: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  Requires Expiry Date
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Expiry Sale Policy</label>
                  <select
                    value={settingsForm.expirySalePolicy}
                    onChange={(e) => setSettingsForm({ ...settingsForm, expirySalePolicy: e.target.value as any })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="block">Block (Strict Pharma)</option>
                    <option value="warn">Warn (Cashier Warning)</option>
                    <option value="allow_authorized">Allow Authorized</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Warning Days Before Expiry</label>
                  <input
                    type="number"
                    min="1"
                    value={settingsForm.expiryWarningDays}
                    onChange={(e) => setSettingsForm({ ...settingsForm, expiryWarningDays: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-blue-600/20"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Traceability Modal */}
      {isTraceModalOpen && selectedBatchForTrace && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Batch Traceability Audit</h2>
                <p className="text-xs text-slate-400">
                  Batch: <span className="font-mono text-emerald-400">{selectedBatchForTrace.batchNumber}</span> | Product: {selectedBatchForTrace.productName}
                </p>
              </div>
              <button
                onClick={() => setIsTraceModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loadingTrace ? (
                <div className="py-8 text-center text-slate-500">Querying sales history...</div>
              ) : traceSales.length === 0 ? (
                <div className="py-8 text-center text-slate-500">No customer sales have been posted for this batch.</div>
              ) : (
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/80 text-slate-400 font-semibold sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Invoice #</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Customer</th>
                      <th className="py-2 px-3">Qty Sold</th>
                      <th className="py-2 px-3 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {traceSales.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-mono text-white">{t.invoiceNumber}</td>
                        <td className="py-2.5 px-3 text-slate-400">{t.saleDate.slice(0, 10)}</td>
                        <td className="py-2.5 px-3">
                          <div className="text-white font-medium">{t.customerName}</div>
                          <div className="text-[10px] text-slate-500">{t.customerPhone}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400 font-semibold">{t.quantitySold} units</td>
                        <td className="py-2.5 px-3 font-mono text-right text-white">Rs. {(t.lineTotalMinor / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800 mt-4">
              <button
                onClick={() => setIsTraceModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

