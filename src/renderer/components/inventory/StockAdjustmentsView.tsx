import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RotateCcw,
  Printer,
  ChevronRight,
  ShieldCheck,
  Send,
  Trash2,
  Package,
  Layers,
  ArrowRight,
  ArrowLeftRight
} from 'lucide-react';
import {
  EnterpriseStockAdjustment,
  EnterpriseStockAdjustmentDetail,
  StockAdjustmentStatus,
  StockAdjustmentReasonCode,
  StockAdjustmentType,
  StockAdjustmentApprovalPolicy
} from '../../../shared/types/stock-adjustment';

export const StockAdjustmentsView: React.FC = () => {
  const [adjustments, setAdjustments] = useState<EnterpriseStockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAdjustment, setSelectedAdjustment] = useState<EnterpriseStockAdjustmentDetail | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isDamagedModalOpen, setIsDamagedModalOpen] = useState(false);
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [policy, setPolicy] = useState<StockAdjustmentApprovalPolicy | null>(null);

  // Locations & Products for New Adjustment Form
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // New Adjustment Form State
  const [formLocationId, setFormLocationId] = useState('');
  const [formAdjType, setFormAdjType] = useState<StockAdjustmentType>('correction');
  const [formReasonCode, setFormReasonCode] = useState<StockAdjustmentReasonCode>('DATA_CORRECTION');
  const [formReasonDesc, setFormReasonDesc] = useState('');
  const [formLines, setFormLines] = useState<
    Array<{
      productId: string;
      productName: string;
      productSku: string;
      systemStock: number;
      countedStock: number;
      difference: number;
      unitCostMinor: number;
      valueImpactMinor: number;
      reason: string;
    }>
  >([]);

  // Damaged Operations Form State
  const [damageOpType, setDamageOpType] = useState<'relocate' | 'writeoff' | 'restore'>('relocate');
  const [damageProductId, setDamageProductId] = useState('');
  const [damageFromLocId, setDamageFromLocId] = useState('');
  const [damageToLocId, setDamageToLocId] = useState('');
  const [damageQty, setDamageQty] = useState<number>(1);
  const [damageReason, setDamageReason] = useState('');

  // Reversal Dialog State
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const api = window.posApi?.stockAdjustments;
      if (api?.list) {
        const filters: any = {};
        if (statusFilter !== 'ALL') filters.status = statusFilter;
        if (searchQuery) filters.search = searchQuery;

        const res = await api.list(filters);
        setAdjustments(res?.items || []);
      }

      if (window.posApi?.stockLocations?.list) {
        const locs = await window.posApi.stockLocations.list();
        setLocations(locs || []);
        if (locs?.length > 0 && !formLocationId) {
          setFormLocationId(locs[0].id);
        }
      }

      if (window.posApi?.inventory?.listProducts) {
        const prods = await window.posApi.inventory.listProducts();
        setProducts(prods || []);
      }

      if (api?.getPolicy) {
        const pol = await api.getPolicy();
        setPolicy(pol);
      }
    } catch (err) {
      console.error('Failed to load stock adjustments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter, searchQuery]);

  const viewDetails = async (id: string) => {
    try {
      const api = window.posApi?.stockAdjustments;
      if (api?.getById) {
        const detail = await api.getById(id);
        setSelectedAdjustment(detail);
        setIsDetailModalOpen(true);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to fetch adjustment details');
    }
  };

  // Add line to adjustment form
  const addLine = (product: any) => {
    if (formLines.some((l) => l.productId === String(product.id))) {
      return; // Already added
    }

    const currentQty = product.currentStock || 0;
    const counted = currentQty;
    const diff = 0;
    const cost = product.costPrice || product.defaultCostMinor || 0;

    setFormLines([
      ...formLines,
      {
        productId: String(product.id),
        productName: product.name,
        productSku: product.sku,
        systemStock: currentQty,
        countedStock: counted,
        difference: diff,
        unitCostMinor: cost,
        valueImpactMinor: 0,
        reason: ''
      }
    ]);
  };

  const updateCounted = (index: number, val: number) => {
    const updated = [...formLines];
    const item = updated[index];
    item.countedStock = Math.max(0, val);
    item.difference = Math.round((item.countedStock - item.systemStock) * 1000) / 1000;
    item.valueImpactMinor = Math.round(item.difference * item.unitCostMinor);
    setFormLines(updated);
  };

  const removeLine = (index: number) => {
    setFormLines(formLines.filter((_, i) => i !== index));
  };

  const handleCreateAdjustment = async (autoPost: boolean) => {
    try {
      if (formLines.length === 0) {
        alert('Please add at least one product to adjust');
        return;
      }
      if (!formReasonDesc.trim()) {
        alert('Reason description is required');
        return;
      }

      const input = {
        stockLocationId: formLocationId,
        adjustmentType: formAdjType,
        reasonCode: formReasonCode,
        reasonDescription: formReasonDesc,
        autoPostIfPermitted: autoPost,
        lines: formLines.map((l) => ({
          productId: l.productId,
          countedQuantityScaled: Math.round(l.countedStock * 1000),
          unitCostMinor: l.unitCostMinor,
          reason: l.reason
        }))
      };

      const api = window.posApi?.stockAdjustments;
      if (api?.create) {
        await api.create(input);
        setIsNewModalOpen(false);
        setFormLines([]);
        setFormReasonDesc('');
        loadData();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create adjustment');
    }
  };

  const handlePostAdjustment = async (id: string, forceRefresh = false) => {
    try {
      const api = window.posApi?.stockAdjustments;
      if (api?.post) {
        await api.post(id, undefined, { forceRefreshSnapshot: forceRefresh });
        viewDetails(id);
        loadData();
      }
    } catch (err: any) {
      if (err.message && err.message.includes('Stock drift detected')) {
        if (
          confirm(
            `${err.message}\n\nDo you want to re-synchronize to the current system stock and confirm posting?`
          )
        ) {
          handlePostAdjustment(id, true);
          return;
        }
      } else {
        alert(err.message || 'Failed to post adjustment');
      }
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const api = window.posApi?.stockAdjustments;
      if (api?.approve) {
        await api.approve(id);
        viewDetails(id);
        loadData();
      }
    } catch (err: any) {
      alert(err.message || 'Approval failed');
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Please enter rejection reason:');
    if (!reason) return;
    try {
      const api = window.posApi?.stockAdjustments;
      if (api?.reject) {
        await api.reject(id, reason);
        viewDetails(id);
        loadData();
      }
    } catch (err: any) {
      alert(err.message || 'Rejection failed');
    }
  };

  const handleReverse = async (id: string) => {
    if (!reversalReason.trim()) {
      alert('Please specify a reason for reversing this posted adjustment');
      return;
    }
    try {
      const api = window.posApi?.stockAdjustments;
      if (api?.reverse) {
        const rev = await api.reverse(id, reversalReason);
        alert(`Adjustment reversed successfully. Compensating record: ${rev.adjustmentNumber}`);
        setIsReversing(false);
        setReversalReason('');
        setIsDetailModalOpen(false);
        loadData();
      }
    } catch (err: any) {
      alert(err.message || 'Reversal failed');
    }
  };

  const handleDamagedOperation = async () => {
    try {
      const api = window.posApi?.stockAdjustments;
      if (!damageProductId) {
        alert('Select a product');
        return;
      }
      if (!damageReason.trim()) {
        alert('Reason description is required');
        return;
      }

      const scaled = Math.round(damageQty * 1000);

      if (damageOpType === 'relocate') {
        if (!damageFromLocId || !damageToLocId) {
          alert('Select both source and damaged locations');
          return;
        }
        await api?.relocateDamaged({
          productId: damageProductId,
          fromLocationId: damageFromLocId,
          toDamagedLocationId: damageToLocId,
          quantityScaled: scaled,
          reasonDescription: damageReason
        });
        alert('Stock relocated to non-sellable damaged location successfully');
      } else if (damageOpType === 'writeoff') {
        if (!damageFromLocId) {
          alert('Select location to write off from');
          return;
        }
        await api?.writeOffDamaged({
          productId: damageProductId,
          stockLocationId: damageFromLocId,
          quantityScaled: scaled,
          reasonDescription: damageReason
        });
        alert('Stock written off and destroyed permanently');
      } else if (damageOpType === 'restore') {
        if (!damageFromLocId || !damageToLocId) {
          alert('Select damaged source and sellable destination location');
          return;
        }
        await api?.returnToSellable({
          productId: damageProductId,
          fromDamagedLocationId: damageFromLocId,
          toSellableLocationId: damageToLocId,
          quantityScaled: scaled,
          reasonDescription: damageReason
        });
        alert('Inspected stock returned to sellable floor successfully');
      }

      setIsDamagedModalOpen(false);
      setDamageReason('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const getStatusBadge = (status: StockAdjustmentStatus) => {
    switch (status) {
      case 'posted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> POSTED
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <ShieldCheck className="w-3 h-3" /> APPROVED
          </span>
        );
      case 'pending_approval':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" /> PENDING
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3" /> REJECTED
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            DRAFT
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" /> Controlled Stock Adjustments
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit-backed stock discrepancies, physical counts, damages, write-offs & managerial approvals
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDamagedModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold transition"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Damage & Write-offs
          </button>
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4" /> New Stock Count
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search adjustment #, reason, note..."
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Status:
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Adjustments Table */}
      <div className="flex-1 bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <th className="py-2.5 px-3 font-semibold">Adjustment #</th>
                <th className="py-2.5 px-3 font-semibold">Date</th>
                <th className="py-2.5 px-3 font-semibold">Location</th>
                <th className="py-2.5 px-3 font-semibold">Reason & Type</th>
                <th className="py-2.5 px-3 font-semibold text-right">Net Difference</th>
                <th className="py-2.5 px-3 font-semibold text-right">Value Impact</th>
                <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                <th className="py-2.5 px-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Loading stock adjustments...
                  </td>
                </tr>
              ) : adjustments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No stock adjustments found. Create a new count or change filters.
                  </td>
                </tr>
              ) : (
                adjustments.map((adj) => {
                  const diffUnits = (adj.totalDifferenceScaled || 0) / 1000;
                  const valMinor = adj.totalValueImpactMinor || 0;
                  const isNegative = diffUnits < 0;
                  const isPositive = diffUnits > 0;

                  return (
                    <tr
                      key={adj.id}
                      onClick={() => viewDetails(adj.id)}
                      className="hover:bg-slate-800/40 transition cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-blue-400">
                        {adj.adjustmentNumber}
                        {adj.reversalOfId && (
                          <span className="block text-[10px] text-amber-400">Reversal</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {new Date(adj.requestedAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {adj.stockLocationName || adj.stockLocationId}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-medium text-slate-200 block">{adj.reasonCode}</span>
                        <span className="text-[11px] text-slate-400 truncate max-w-xs block">
                          {adj.reasonDescription}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {isNegative ? (
                          <span className="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded">
                            {diffUnits.toFixed(3)}
                          </span>
                        ) : isPositive ? (
                          <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                            +{diffUnits.toFixed(3)}
                          </span>
                        ) : (
                          <span className="text-slate-400">0.000</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                        Rs. {(valMinor / 100).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center">{getStatusBadge(adj.status)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">
                        <ChevronRight className="w-4 h-4 inline" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW ADJUSTMENT MODAL */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-400" /> New Controlled Stock Adjustment
                </h3>
                <p className="text-xs text-slate-400">
                  Input physical counted stock. Differences are calculated automatically: Counted − System.
                </p>
              </div>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {/* Top Configuration */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Stock Location *
                  </label>
                  <select
                    value={formLocationId}
                    onChange={(e) => setFormLocationId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.locationType})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Reason Code *
                  </label>
                  <select
                    value={formReasonCode}
                    onChange={(e) => setFormReasonCode(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="DAMAGED">Damaged</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="MISSING">Missing</option>
                    <option value="THEFT">Theft</option>
                    <option value="BROKEN">Broken</option>
                    <option value="FOUND_STOCK">Found Stock</option>
                    <option value="DATA_CORRECTION">Data Correction</option>
                    <option value="OPENING_BALANCE_CORRECTION">Opening Balance Correction</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Adjustment Type *
                  </label>
                  <select
                    value={formAdjType}
                    onChange={(e) => setFormAdjType(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="correction">Correction</option>
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                    <option value="damage">Damage</option>
                    <option value="expiry">Expiry</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Reason Description (Mandatory for 'OTHER') *
                  </label>
                  <input
                    type="text"
                    value={formReasonDesc}
                    onChange={(e) => setFormReasonDesc(e.target.value)}
                    placeholder="e.g. Broken packaging discovered during shelf auditing in aisle 3"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              {/* Product Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    Add Products to Adjust
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Click product to add to count table
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 bg-slate-950/40 rounded-lg border border-slate-800">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addLine(p)}
                      className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3 text-blue-400" />
                      {p.name} <span className="text-slate-400 text-[10px]">({p.sku})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Lines Table with Real-time Counted vs System vs Difference */}
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3 text-right">System Stock</th>
                      <th className="py-2 px-3 text-center">Physical Count</th>
                      <th className="py-2 px-3 text-right">Difference</th>
                      <th className="py-2 px-3 text-right">Value Impact</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {formLines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          No products added yet. Click a product above to begin auditing.
                        </td>
                      </tr>
                    ) : (
                      formLines.map((line, idx) => (
                        <tr key={line.productId} className="hover:bg-slate-800/30">
                          <td className="py-2 px-3">
                            <span className="font-semibold text-slate-200 block">
                              {line.productName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {line.productSku}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">
                            {line.systemStock}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={line.countedStock}
                              onChange={(e) => updateCounted(idx, parseFloat(e.target.value) || 0)}
                              className="w-24 bg-slate-950 border border-blue-500/50 rounded px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold">
                            {line.difference < 0 ? (
                              <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">
                                {line.difference}
                              </span>
                            ) : line.difference > 0 ? (
                              <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                +{line.difference}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">
                            Rs. {(line.valueImpactMinor / 100).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => removeLine(idx)}
                              className="text-rose-400 hover:text-rose-300 p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/40">
              <span className="text-xs text-slate-400">
                Total lines: {formLines.length} | Net Value:{' '}
                <strong className="text-white">
                  Rs.{' '}
                  {(
                    formLines.reduce((sum, l) => sum + l.valueImpactMinor, 0) / 100
                  ).toFixed(2)}
                </strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleCreateAdjustment(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Save as Draft / Pending
                </button>
                <button
                  onClick={() => handleCreateAdjustment(true)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Post Adjustment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADJUSTMENT DETAIL & REVIEW MODAL */}
      {isDetailModalOpen && selectedAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white font-mono">
                    {selectedAdjustment.adjustmentNumber}
                  </h3>
                  {getStatusBadge(selectedAdjustment.status)}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Location: {selectedAdjustment.stockLocationName} | Reason: {selectedAdjustment.reasonCode} ({selectedAdjustment.reasonDescription})
                </p>
              </div>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Audit Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[10px]">Requested By:</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedAdjustment.requestedByName || selectedAdjustment.requestedBy}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Requested At:</span>
                  <span className="text-slate-200">
                    {new Date(selectedAdjustment.requestedAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Approved By:</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedAdjustment.approvedByName || selectedAdjustment.approvedBy || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Posted By:</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedAdjustment.postedByName || selectedAdjustment.postedBy || '—'}
                  </span>
                </div>
              </div>

              {/* Adjustment Lines Snapshot Table */}
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3 text-right">System Snapshot</th>
                      <th className="py-2 px-3 text-right">Counted Physical</th>
                      <th className="py-2 px-3 text-right">Difference</th>
                      <th className="py-2 px-3 text-right">Unit Cost</th>
                      <th className="py-2 px-3 text-right">Value Impact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {selectedAdjustment.lines.map((l) => {
                      const sys = l.systemQuantityScaled / 1000;
                      const cnt = l.countedQuantityScaled / 1000;
                      const diff = l.differenceQuantityScaled / 1000;
                      const valMinor = l.totalValueMinor || 0;

                      return (
                        <tr key={l.id}>
                          <td className="py-2 px-3">
                            <span className="font-semibold text-slate-200 block">
                              {l.productName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {l.productSku}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">
                            {sys.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">
                            {cnt.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold">
                            {diff < 0 ? (
                              <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">
                                {diff.toFixed(3)}
                              </span>
                            ) : diff > 0 ? (
                              <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                +{diff.toFixed(3)}
                              </span>
                            ) : (
                              <span className="text-slate-400">0.000</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            Rs. {((l.unitCostMinor || 0) / 100).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-200 font-semibold">
                            Rs. {(valMinor / 100).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Reversal Section */}
              {selectedAdjustment.status === 'posted' && (
                <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-rose-300 block">
                      Posted & Immutable Record
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      This record cannot be edited or physically deleted. To correct, create a reversal.
                    </span>
                  </div>
                  {!isReversing ? (
                    <button
                      onClick={() => setIsReversing(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reverse Adjustment
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={reversalReason}
                        onChange={(e) => setReversalReason(e.target.value)}
                        placeholder="Reason for reversal..."
                        className="bg-slate-900 border border-rose-500/40 rounded px-2.5 py-1 text-xs text-white"
                      />
                      <button
                        onClick={() => handleReverse(selectedAdjustment.id)}
                        className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-semibold"
                      >
                        Confirm Reversal
                      </button>
                      <button
                        onClick={() => setIsReversing(false)}
                        className="text-slate-400 hover:text-white text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions based on status */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/40">
              <button
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" /> Print Audit Sheet
              </button>

              <div className="flex items-center gap-2">
                {selectedAdjustment.status === 'pending_approval' && (
                  <>
                    <button
                      onClick={() => handleReject(selectedAdjustment.id)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(selectedAdjustment.id)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      Approve Adjustment
                    </button>
                  </>
                )}

                {selectedAdjustment.status === 'approved' && (
                  <button
                    onClick={() => handlePostAdjustment(selectedAdjustment.id)}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" /> Post to Inventory Ledger
                  </button>
                )}

                <button
                  onClick={() => setIsDetailModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAMAGED & WRITE-OFF MODAL */}
      {isDamagedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" /> Damage, Quarantine & Write-off Controls
              </h3>
              <button
                onClick={() => setIsDamagedModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Operation Type Switch */}
            <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setDamageOpType('relocate')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                  damageOpType === 'relocate'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Move to Damaged
              </button>
              <button
                type="button"
                onClick={() => setDamageOpType('writeoff')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                  damageOpType === 'writeoff'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Write Off / Scrap
              </button>
              <button
                type="button"
                onClick={() => setDamageOpType('restore')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                  damageOpType === 'restore'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Return to Sellable
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Product *</label>
                <select
                  value={damageProductId}
                  onChange={(e) => setDamageProductId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              {damageOpType === 'relocate' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">From Location (Sellable) *</label>
                    <select
                      value={damageFromLocId}
                      onChange={(e) => setDamageFromLocId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="">-- Select Source --</option>
                      {locations.filter((l: any) => l.isSellable).map((l: any) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">To Damaged Location *</label>
                    <select
                      value={damageToLocId}
                      onChange={(e) => setDamageToLocId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="">-- Select Damaged Loc --</option>
                      {locations.filter((l: any) => !l.isSellable || l.locationType === 'damaged' || l.locationType === 'quarantine').map((l: any) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.locationType})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {damageOpType === 'writeoff' && (
                <div>
                  <label className="block text-slate-400 mb-1">Write-off From Location *</label>
                  <select
                    value={damageFromLocId}
                    onChange={(e) => setDamageFromLocId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                  >
                    <option value="">-- Select Location --</option>
                    {locations.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.locationType})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {damageOpType === 'restore' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">From Damaged Location *</label>
                    <select
                      value={damageFromLocId}
                      onChange={(e) => setDamageFromLocId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="">-- Select Damaged --</option>
                      {locations.filter((l: any) => !l.isSellable || l.locationType === 'damaged' || l.locationType === 'quarantine').map((l: any) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">To Sellable Floor Location *</label>
                    <select
                      value={damageToLocId}
                      onChange={(e) => setDamageToLocId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="">-- Select Floor --</option>
                      {locations.filter((l: any) => l.isSellable).map((l: any) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={damageQty}
                    onChange={(e) => setDamageQty(parseFloat(e.target.value) || 1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-400 mb-1">Reason / Inspection Report *</label>
                  <input
                    type="text"
                    value={damageReason}
                    onChange={(e) => setDamageReason(e.target.value)}
                    placeholder="e.g. Expired seal broken or physical breakage"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsDamagedModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDamagedOperation}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Execute Operation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
