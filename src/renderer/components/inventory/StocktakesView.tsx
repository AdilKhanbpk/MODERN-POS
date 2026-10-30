import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  Plus,
  Play,
  CheckCircle,
  Eye,
  EyeOff,
  Snowflake,
  RotateCcw,
  AlertTriangle,
  FileText,
  Search,
  Barcode,
  Check,
  X,
  Printer,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';
import {
  Stocktake,
  StocktakeLine,
  StocktakeCountMode,
  StocktakeCountingMode,
  StocktakeSummaryReport
} from '../../../shared/types/stocktake';

export const StocktakesView: React.FC = () => {
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStocktake, setSelectedStocktake] = useState<Stocktake | null>(null);
  const [report, setReport] = useState<StocktakeSummaryReport | null>(null);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCountingStationOpen, setIsCountingStationOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Form states
  const [newLocationId, setNewLocationId] = useState('');
  const [newCountMode, setNewCountMode] = useState<StocktakeCountMode>('full');
  const [newCountingMode, setNewCountingMode] = useState<StocktakeCountingMode>('blind');
  const [newFreezeStock, setNewFreezeStock] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Counting station state
  const [barcodeInput, setBarcodeInput] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [activeQuantities, setActiveQuantities] = useState<Record<string, number>>({});

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      if ((window.posApi as any)?.stocktakes) {
        const list = await (window.posApi as any).stocktakes.list({ businessId });
        setStocktakes(list || []);
      }
      if ((window.posApi as any)?.stockLocations) {
        const locs = await (window.posApi as any).stockLocations.list();
        setLocations(locs || []);
        if (locs && locs.length > 0 && !newLocationId) {
          setNewLocationId(locs[0].id);
        }
      }
      if (window.posApi?.inventory) {
        const cats = await window.posApi.inventory.listCategories();
        setCategories(cats || []);
      }
    } catch (err) {
      console.error('Failed to load stocktake data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async () => {
    if (!newLocationId) {
      alert('Please select a stock location.');
      return;
    }

    try {
      setLoading(true);
      const res = await (window.posApi as any).stocktakes.create({
        businessId,
        stockLocationId: newLocationId,
        countMode: newCountMode,
        countingMode: newCountingMode,
        freezeStock: newFreezeStock,
        scopeCategoryId: newCountMode === 'category' ? newCategoryId : null,
        notes: newNotes
      });

      setIsCreateOpen(false);
      await loadData();
      if (res?.id) {
        openCountingStation(res.id);
      }
    } catch (err: any) {
      alert(`Failed to create stocktake: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const openCountingStation = async (id: string) => {
    try {
      setLoading(true);
      const st = await (window.posApi as any).stocktakes.getById(id);
      if (st.status === 'draft') {
        await (window.posApi as any).stocktakes.start(id);
        const started = await (window.posApi as any).stocktakes.getById(id);
        setSelectedStocktake(started);
      } else {
        setSelectedStocktake(st);
      }
      setIsCountingStationOpen(true);
    } catch (err: any) {
      alert(`Could not open counting station: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScanBarcode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim() || !selectedStocktake) return;

    try {
      await (window.posApi as any).stocktakes.recordCount({
        stocktakeId: selectedStocktake.id,
        productBarcode: barcodeInput.trim(),
        incrementalScanQuantityScaled: 1000 // +1 unit per scan
      });
      setBarcodeInput('');
      // Refresh current stocktake lines
      const updated = await (window.posApi as any).stocktakes.getById(selectedStocktake.id);
      setSelectedStocktake(updated);
    } catch (err: any) {
      alert(`Scan failed: ${err.message || err}`);
    }
  };

  const handleUpdateQuantity = async (line: StocktakeLine, qty: number) => {
    if (!selectedStocktake) return;
    try {
      await (window.posApi as any).stocktakes.recordCount({
        stocktakeId: selectedStocktake.id,
        productId: line.productId,
        countedQuantityScaled: Math.round(qty * 1000)
      });
      const updated = await (window.posApi as any).stocktakes.getById(selectedStocktake.id);
      setSelectedStocktake(updated);
    } catch (err: any) {
      alert(`Update quantity failed: ${err.message || err}`);
    }
  };

  const handleSubmitCounts = async () => {
    if (!selectedStocktake) return;
    if (!confirm('Submit physical counts for supervisor review? Counters cannot edit counts after submission.')) {
      return;
    }

    try {
      setLoading(true);
      await (window.posApi as any).stocktakes.submitCounts(selectedStocktake.id);
      await (window.posApi as any).stocktakes.review(selectedStocktake.id);
      setIsCountingStationOpen(false);
      await openReview(selectedStocktake.id);
    } catch (err: any) {
      alert(`Submit failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const openReview = async (id: string) => {
    try {
      setLoading(true);
      const st = await (window.posApi as any).stocktakes.getById(id, { role: 'supervisor' });
      setSelectedStocktake(st);
      setIsReviewOpen(true);
    } catch (err: any) {
      alert(`Failed to open review: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!selectedStocktake) return;
    if (!confirm('Post stock adjustments to the inventory ledger? This will permanently update inventory balances.')) {
      return;
    }

    try {
      setLoading(true);
      if (selectedStocktake.status !== 'approved') {
        await (window.posApi as any).stocktakes.approve(selectedStocktake.id);
      }
      await (window.posApi as any).stocktakes.post(selectedStocktake.id);
      setIsReviewOpen(false);
      await openReport(selectedStocktake.id);
      await loadData();
    } catch (err: any) {
      alert(`Posting failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const openReport = async (id: string) => {
    try {
      setLoading(true);
      const rep = await (window.posApi as any).stocktakes.getReport(id);
      setReport(rep);
      setIsReportOpen(true);
    } catch (err: any) {
      alert(`Failed to load report: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">In Progress</span>;
      case 'count_submitted':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Submitted</span>;
      case 'review':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Review</span>;
      case 'approved':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">Approved</span>;
      case 'posted':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">Posted</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Draft</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-indigo-600" />
            Physical Stocktake & Counting
          </h2>
          <p className="text-sm text-gray-500">
            Audit inventory, conduct blind or visible counts, reconcile concurrent sales, and post verified discrepancies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Stocktake
          </button>
        </div>
      </div>

      {/* Stocktakes Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase font-semibold text-gray-600">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Policy</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stocktakes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    No physical stocktakes recorded yet. Click "New Stocktake" to begin an inventory audit.
                  </td>
                </tr>
              ) : (
                stocktakes.map((st) => (
                  <tr key={st.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-900">{st.stocktakeNumber}</td>
                    <td className="px-4 py-3 text-gray-700">{st.locationName || 'Main Storage'}</td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-gray-700">{st.countMode}</span>
                    </td>
                    <td className="px-4 py-3">
                      {st.countingMode === 'blind' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                          <EyeOff className="w-3 h-3" /> Blind
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          <Eye className="w-3 h-3" /> Visible
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {st.freezeStock ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                          <Snowflake className="w-3 h-3" /> Frozen
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Live Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(st.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 font-medium">
                          {st.countedLinesCount || 0} / {st.totalLinesCount || 0}
                        </span>
                        {(st.discrepancyLinesCount || 0) > 0 && (
                          <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                            {st.discrepancyLinesCount} diff
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {st.createdAt ? new Date(st.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {st.status === 'draft' || st.status === 'in_progress' ? (
                          <button
                            onClick={() => openCountingStation(st.id)}
                            className="px-2.5 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" /> Count
                          </button>
                        ) : null}

                        {st.status === 'count_submitted' || st.status === 'review' ? (
                          <button
                            onClick={() => openReview(st.id)}
                            className="px-2.5 py-1 text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 rounded flex items-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" /> Review
                          </button>
                        ) : null}

                        {st.status === 'posted' ? (
                          <button
                            onClick={() => openReport(st.id)}
                            className="px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" /> Report
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE STOCKTAKE MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Initiate Physical Stocktake</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block font-medium text-gray-700 mb-1">Target Stock Location</label>
                <select
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.is_sellable ? '(Sellable)' : '(Non-sellable / Quarantine)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">Counting Scope</label>
                  <select
                    value={newCountMode}
                    onChange={(e) => setNewCountMode(e.target.value as StocktakeCountMode)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="full">Full Stocktake (All Items)</option>
                    <option value="category">Category-Specific</option>
                    <option value="cycle">Cycle Count</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-gray-700 mb-1">Counting Mode</label>
                  <select
                    value={newCountingMode}
                    onChange={(e) => setNewCountingMode(e.target.value as StocktakeCountingMode)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="blind">Blind (Hide Recorded Quantities)</option>
                    <option value="visible">Visible (Display System Stock)</option>
                  </select>
                </div>
              </div>

              {newCountMode === 'category' && (
                <div>
                  <label className="block font-medium text-gray-700 mb-1">Select Category</label>
                  <select
                    value={newCategoryId}
                    onChange={(e) => setNewCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="">Select Category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Policy A vs B explanation */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-900">
                  <input
                    type="checkbox"
                    checked={newFreezeStock}
                    onChange={(e) => setNewFreezeStock(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  Freeze stock movements during count (Policy A)
                </label>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {newFreezeStock
                    ? 'Policy A: Blocks sales and transfers for this location until counting completes. Cashiers will see a freeze warning.'
                    : 'Policy B: Allows sales to continue. System automatically reconciles physical counts against sales occurred between snapshot and count cutoff.'}
                </p>
              </div>

              <div>
                <label className="block font-medium text-gray-700 mb-1">Notes / Instructions</label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. End-of-month audit in Main Warehouse"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
              <button
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
              >
                Start Counting
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COUNTING STATION MODAL */}
      {isCountingStationOpen && selectedStocktake && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-indigo-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg">{selectedStocktake.stocktakeNumber}</span>
                  <span className="text-xs px-2 py-0.5 bg-indigo-800 rounded font-medium">
                    {selectedStocktake.locationName || 'Main Storage'}
                  </span>
                  {selectedStocktake.countingMode === 'blind' ? (
                    <span className="text-xs px-2 py-0.5 bg-purple-500 text-white rounded font-medium flex items-center gap-1">
                      <EyeOff className="w-3 h-3" /> Blind Mode
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded font-medium flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Visible Mode
                    </span>
                  )}
                </div>
                <p className="text-xs text-indigo-200 mt-0.5">
                  Scan barcodes with keyboard-wedge scanner or search products below.
                </p>
              </div>
              <button onClick={() => setIsCountingStationOpen(false)} className="text-indigo-200 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Barcode Scanner Bar */}
            <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
              <form onSubmit={handleScanBarcode} className="flex-1 flex items-center gap-2">
                <div className="relative flex-1">
                  <Barcode className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    autoFocus
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="Scan product barcode (each scan increments count by 1)..."
                    className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                >
                  Count (+1)
                </button>
              </form>
              <div className="relative w-64">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Filter by name / SKU..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                />
              </div>
            </div>

            {/* Scoped Lines List */}
            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 text-xs uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">SKU / Barcode</th>
                    {selectedStocktake.countingMode === 'visible' && (
                      <th className="px-3 py-2 text-right">System Recorded</th>
                    )}
                    <th className="px-3 py-2 text-right">Physical Count</th>
                    {selectedStocktake.countingMode === 'visible' && (
                      <th className="px-3 py-2 text-right">Live Variance</th>
                    )}
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(selectedStocktake.lines || [])
                    .filter((l) => {
                      if (!filterSearch) return true;
                      const q = filterSearch.toLowerCase();
                      return (
                        l.productName?.toLowerCase().includes(q) ||
                        l.productSku?.toLowerCase().includes(q) ||
                        l.productBarcode?.toLowerCase().includes(q)
                      );
                    })
                    .map((line) => {
                      const countedQty = line.countedQuantityScaled !== null ? line.countedQuantityScaled / 1000 : 0;
                      const systemQty = line.systemQuantityScaled !== null ? line.systemQuantityScaled / 1000 : null;
                      const diffQty = line.differenceQuantityScaled !== null ? line.differenceQuantityScaled / 1000 : null;

                      return (
                        <tr key={line.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900">{line.productName}</td>
                          <td className="px-3 py-2 text-xs font-mono text-gray-500">
                            {line.productSku} {line.productBarcode ? `| ${line.productBarcode}` : ''}
                          </td>
                          {selectedStocktake.countingMode === 'visible' && (
                            <td className="px-3 py-2 text-right font-medium text-gray-700">
                              {systemQty !== null ? systemQty : '-'}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="any"
                              value={activeQuantities[line.id] !== undefined ? activeQuantities[line.id] : countedQty}
                              onChange={(e) =>
                                setActiveQuantities({
                                  ...activeQuantities,
                                  [line.id]: parseFloat(e.target.value) || 0
                                })
                              }
                              onBlur={(e) => handleUpdateQuantity(line, parseFloat(e.target.value) || 0)}
                              className="w-24 text-right px-2 py-1 border rounded focus:ring-2 focus:ring-indigo-500 text-sm font-semibold"
                            />
                          </td>
                          {selectedStocktake.countingMode === 'visible' && (
                            <td className="px-3 py-2 text-right">
                              {diffQty !== null ? (
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded ${
                                    diffQty === 0
                                      ? 'text-gray-600 bg-gray-100'
                                      : diffQty > 0
                                      ? 'text-emerald-700 bg-emerald-50'
                                      : 'text-rose-700 bg-rose-50'
                                  }`}
                                >
                                  {diffQty > 0 ? `+${diffQty}` : diffQty}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 text-center">
                            {line.countStatus === 'uncounted' ? (
                              <span className="text-xs text-gray-400">Pending</span>
                            ) : line.countStatus === 'recount_required' ? (
                              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium">
                                Recount Req
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                                Counted
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleUpdateQuantity(line, (line.countedQuantityScaled || 0) / 1000 + 1)}
                              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded font-semibold text-gray-700"
                            >
                              +1
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Bottom Actions */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">
                Counts are autosaved to local SQLite database in real-time.
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsCountingStationOpen(false)}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Close
                </button>
                <button
                  onClick={handleSubmitCounts}
                  className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium flex items-center gap-1"
                >
                  <Check className="w-4 h-4" />
                  Submit Counts for Review
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUPERVISOR REVIEW & DISCREPANCY RECONCILIATION MODAL */}
      {isReviewOpen && selectedStocktake && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-purple-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-purple-300" />
                  Supervisor Discrepancy Review — {selectedStocktake.stocktakeNumber}
                </h3>
                <p className="text-xs text-purple-200">
                  Review counted reality vs system expectation. Verify Policy B cutoff sales and approve adjustments.
                </p>
              </div>
              <button onClick={() => setIsReviewOpen(false)} className="text-purple-200 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Snapshot Stock</th>
                      <th className="px-3 py-2 text-right">Cutoff Movements</th>
                      <th className="px-3 py-2 text-right">Expected Stock</th>
                      <th className="px-3 py-2 text-right">Physical Count</th>
                      <th className="px-3 py-2 text-right">Variance</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(selectedStocktake.lines || []).map((line) => {
                      const snap = line.systemQuantityScaled !== null ? line.systemQuantityScaled / 1000 : 0;
                      const cutoff = line.cutoffMovementsQtyScaled / 1000;
                      const expected = line.expectedQuantityScaled !== null ? line.expectedQuantityScaled / 1000 : snap;
                      const counted = line.countedQuantityScaled !== null ? line.countedQuantityScaled / 1000 : 0;
                      const diff = line.differenceQuantityScaled !== null ? line.differenceQuantityScaled / 1000 : 0;

                      return (
                        <tr key={line.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{line.productName}</div>
                            <div className="text-xs text-gray-500 font-mono">{line.productSku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-700">{snap}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">
                            {cutoff !== 0 ? (cutoff > 0 ? `+${cutoff}` : cutoff) : '0'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">{expected}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{counted}</td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className={`text-xs font-bold px-2 py-0.5 rounded ${
                                diff === 0
                                  ? 'text-gray-500 bg-gray-100'
                                  : diff > 0
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-rose-700 bg-rose-50'
                              }`}
                            >
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs font-medium capitalize text-gray-700">{line.countStatus}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Approving and posting will generate authoritative STOCKTAKE_SURPLUS and STOCKTAKE_DEFICIT movements.
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsReviewOpen(false)}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePost}
                  disabled={loading}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-1"
                >
                  <Check className="w-4 h-4" />
                  Approve & Post Adjustments
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT REPORT MODAL */}
      {isReportOpen && report && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-gray-900 text-white flex items-center justify-between print:hidden">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                Stocktake Audit Report — {report.stocktake.stocktakeNumber}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-white"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button onClick={() => setIsReportOpen(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs text-gray-500 font-medium">Total Items Scoped</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{report.metrics.totalScopedItems}</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="text-xs text-emerald-700 font-medium">Exact Matches</div>
                  <div className="text-xl font-bold text-emerald-800 mt-1">{report.metrics.exactMatchItems}</div>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-xs text-blue-700 font-medium">Surplus Items</div>
                  <div className="text-xl font-bold text-blue-800 mt-1">
                    {report.metrics.surplusItemsCount} (+{report.metrics.totalSurplusQuantityScaled / 1000})
                  </div>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                  <div className="text-xs text-rose-700 font-medium">Deficit Items</div>
                  <div className="text-xl font-bold text-rose-800 mt-1">
                    {report.metrics.deficitItemsCount} (-{report.metrics.totalDeficitQuantityScaled / 1000})
                  </div>
                </div>
              </div>

              {/* Monetary Net Variance */}
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-indigo-700 tracking-wider">Net Financial Impact</span>
                  <div className="text-lg font-bold text-indigo-900 mt-0.5">
                    Rs. {(report.metrics.netMonetaryVarianceMinor / 100).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold text-indigo-700 tracking-wider">Discrepancy Rate</span>
                  <div className="text-lg font-bold text-indigo-900 mt-0.5">
                    {report.metrics.discrepancyRatePercentage}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

