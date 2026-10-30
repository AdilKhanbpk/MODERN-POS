import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Plus,
  Search,
  ShoppingCart,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sliders,
  Package,
  Layers,
  ArrowRight,
  ShieldCheck,
  Building
} from 'lucide-react';
import {
  ReplenishmentSuggestion,
  ReplenishmentUrgency,
  ProductReorderRule,
  CalculationReason,
  StockAlert
} from '../../../shared/types/stock-replenishment';

export const StockReplenishmentView: React.FC = () => {
  const [suggestions, setSuggestions] = useState<ReplenishmentSuggestion[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [selectedReason, setSelectedReason] = useState<CalculationReason | null>(null);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [scanPeriodDays, setScanPeriodDays] = useState(30);
  const [includeIncoming, setIncludeIncoming] = useState(true);

  // References
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Reorder rule form
  const [ruleForm, setRuleForm] = useState({
    productId: '',
    stockLocationId: '',
    minimumStock: 10,
    reorderPoint: 20,
    targetStock: 50,
    preferredSupplierId: '',
    leadTimeDays: 7,
    safetyStock: 5
  });

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      if ((window as any).posApi?.replenishment) {
        const suggList = await (window as any).posApi.replenishment.listSuggestions({
          businessId,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          supplierId: supplierFilter !== 'all' ? supplierFilter : undefined,
          search: searchQuery || undefined
        });
        setSuggestions(suggList || []);

        const alertList = await (window as any).posApi.replenishment.getAlerts(businessId);
        setAlerts(alertList || []);
      }

      if ((window as any).posApi?.suppliers) {
        const supList = await (window as any).posApi.suppliers.list(businessId);
        setSuppliers(supList || []);
      }
      if ((window as any).posApi?.stockLocations) {
        const locList = await (window as any).posApi.stockLocations.list(businessId);
        setLocations(locList || []);
      }
      if ((window as any).posApi?.inventory) {
        const prodList = await (window as any).posApi.inventory.listProducts();
        setProducts(prodList || []);
      }
    } catch (err) {
      console.error('Failed to load replenishment data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter, supplierFilter]);

  const handleScan = async () => {
    try {
      setLoading(true);
      if ((window as any).posApi?.replenishment) {
        await (window as any).posApi.replenishment.generateSuggestions({
          businessId,
          historyPeriodDays: scanPeriodDays,
          includeIncoming
        });
        loadData();
      }
    } catch (err: any) {
      alert(`Replenishment scan error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await (window as any).posApi.replenishment.setRule({
        businessId,
        productId: ruleForm.productId,
        stockLocationId: ruleForm.stockLocationId || null,
        minimumStockScaled: Math.round(ruleForm.minimumStock * 1000),
        reorderPointScaled: Math.round(ruleForm.reorderPoint * 1000),
        targetStockScaled: Math.round(ruleForm.targetStock * 1000),
        preferredSupplierId: ruleForm.preferredSupplierId || null,
        leadTimeDays: Number(ruleForm.leadTimeDays),
        safetyStockScaled: Math.round(ruleForm.safetyStock * 1000)
      });
      setIsRuleModalOpen(false);
      alert('Reorder rule configured successfully!');
      handleScan();
    } catch (err: any) {
      alert(`Reorder rule error: ${err.message}`);
    }
  };

  const handleEditQuantity = async (suggId: string, currentVal: number) => {
    const val = prompt('Edit suggested replenishment quantity (pieces):', String(currentVal));
    if (val === null) return;
    const num = Number(val);
    if (isNaN(num) || num <= 0) {
      alert('Please enter a valid positive number.');
      return;
    }
    try {
      await (window as any).posApi.replenishment.editSuggestion(suggId, Math.round(num * 1000));
      loadData();
    } catch (err: any) {
      alert(`Error updating quantity: ${err.message}`);
    }
  };

  const handleDismiss = async (suggId: string) => {
    try {
      await (window as any).posApi.replenishment.dismissSuggestion(suggId);
      loadData();
    } catch (err: any) {
      alert(`Error dismissing suggestion: ${err.message}`);
    }
  };

  const handleConvertToDraftPo = async () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one suggestion.');
      return;
    }

    // Determine supplier
    const selectedItems = suggestions.filter((s) => selectedIds.includes(s.id));
    const firstSupplierId = selectedItems[0]?.preferredSupplierId;

    if (!firstSupplierId) {
      alert('Selected items do not have a preferred supplier assigned. Please configure supplier first.');
      return;
    }

    const hasMixedSuppliers = selectedItems.some((s) => String(s.preferredSupplierId) !== String(firstSupplierId));
    if (hasMixedSuppliers) {
      alert('Selected suggestions belong to multiple different suppliers. Please filter by supplier and convert them individually.');
      return;
    }

    try {
      const res = await (window as any).posApi.replenishment.convertToPo({
        businessId,
        supplierId: firstSupplierId,
        suggestionIds: selectedIds,
        notes: `Converted from stock replenishment engine (${selectedIds.length} items)`
      });

      alert(`Success! Generated Draft Purchase Order #${res.purchaseOrderNumber}. No stock or financial postings occurred.`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      alert(`Conversion error: ${err.message}`);
    }
  };

  const getUrgencyBadge = (urgency?: ReplenishmentUrgency) => {
    switch (urgency) {
      case 'OUT_OF_STOCK':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">Out of Stock</span>;
      case 'BELOW_MINIMUM':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">Below Min</span>;
      case 'BELOW_REORDER_POINT':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">Reorder Point</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-700 text-slate-300">Adequate</span>;
    }
  };

  const oosCount = alerts.filter(a => a.type === 'OUT_OF_STOCK').length;
  const belowMinCount = alerts.filter(a => a.type === 'BELOW_MINIMUM').length;
  const belowRopCount = alerts.filter(a => a.type === 'BELOW_REORDER_POINT').length;

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Header & Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            Stock Replenishment & Demand Forecasting
          </h2>
          <p className="text-xs text-slate-400">
            Intelligent purchase recommendations based on target stock, sales velocity, and supplier lead times.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-950/40 border border-rose-900/60 rounded-lg text-xs">
            <span className="text-rose-300">Out of Stock:</span>
            <span className="font-bold text-rose-400">{oosCount}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/40 border border-amber-900/60 rounded-lg text-xs">
            <span className="text-amber-300">Below Min:</span>
            <span className="font-bold text-amber-400">{belowMinCount}</span>
          </div>
          <button
            onClick={() => setIsRuleModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
          >
            <Sliders className="w-3.5 h-3.5" /> Reorder Rules
          </button>
          <button
            onClick={handleScan}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Scan Inventory
          </button>
        </div>
      </div>

      {/* Filter & Action Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search product, SKU, or supplier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadData()}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
        >
          <option value="all">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
        >
          <option value="open">Open Suggestions</option>
          <option value="converted">Converted to PO</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All Statuses</option>
        </select>

        {selectedIds.length > 0 && (
          <button
            onClick={handleConvertToDraftPo}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition animate-pulse"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Convert Selected ({selectedIds.length}) to Draft PO
          </button>
        )}
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-800 bg-slate-900/50">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === suggestions.filter(s => s.status === 'open').length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(suggestions.filter(s => s.status === 'open').map(s => s.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
              </th>
              <th className="px-3 py-3">Product / SKU</th>
              <th className="px-3 py-3">Location</th>
              <th className="px-3 py-3">Supplier</th>
              <th className="px-3 py-3">Available / Target</th>
              <th className="px-3 py-3">Urgency</th>
              <th className="px-3 py-3">Suggested Reorder</th>
              <th className="px-3 py-3">Packaging Unit</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  Scanning inventory replenishment rules...
                </td>
              </tr>
            ) : suggestions.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  No replenishment recommendations at this time. All stock levels are adequate.
                </td>
              </tr>
            ) : (
              suggestions.map((s) => {
                const isSelected = selectedIds.includes(s.id);
                const suggestedUnits = s.suggestedQuantityScaled / 1000;
                const availableUnits = s.currentAvailableScaled / 1000;
                const targetUnits = s.targetStockScaled / 1000;
                const reason = s.calculationReason;

                return (
                  <tr key={s.id} className={`hover:bg-slate-800/40 transition ${isSelected ? 'bg-indigo-950/20' : ''}`}>
                    <td className="px-3 py-3">
                      {s.status === 'open' && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds([...selectedIds, s.id]);
                            } else {
                              setSelectedIds(selectedIds.filter(id => id !== s.id));
                            }
                          }}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-white">{s.productName || s.productId}</div>
                      <div className="text-[10px] text-slate-400">{s.sku}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-400">{s.locationName}</td>
                    <td className="px-3 py-3 text-slate-300">
                      {s.preferredSupplierName || <span className="text-slate-500 italic">Unassigned</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={availableUnits <= 0 ? 'text-rose-400 font-bold' : 'text-slate-200'}>
                        {availableUnits}
                      </span>
                      <span className="text-slate-500 mx-1">/</span>
                      <span className="text-slate-400">{targetUnits}</span>
                    </td>
                    <td className="px-3 py-3">{getUrgencyBadge(s.urgency)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-emerald-400 text-sm">{suggestedUnits}</span>
                        {s.status === 'open' && (
                          <button
                            onClick={() => handleEditQuantity(s.id, suggestedUnits)}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 underline"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {reason?.packagingUnit && reason.packagesCount ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                          {reason.packagesCount} {reason.packagingUnit}s
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Individual</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedReason(reason)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition"
                          title="View exact demand and replenishment math"
                        >
                          Reason
                        </button>
                        {s.status === 'open' && (
                          <button
                            onClick={() => handleDismiss(s.id)}
                            className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded text-[11px] transition"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Calculation Reason Explanation Modal */}
      {selectedReason && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl flex flex-col space-y-4 text-xs">
            <div className="pb-2 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-indigo-400" />
                  Replenishment Calculation Details
                </h3>
                <p className="text-slate-400">Audited mathematical justification for recommendation.</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                selectedReason.confidence === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400' :
                selectedReason.confidence === 'MEDIUM' ? 'bg-blue-500/20 text-blue-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {selectedReason.confidence} Confidence
              </span>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">Method:</span>
                  <span className="font-semibold text-white">{selectedReason.method}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Sales History Period:</span>
                  <span className="font-semibold text-white">{selectedReason.analysisPeriodDays} days</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Average Daily Demand:</span>
                  <span className="font-semibold text-emerald-400">{selectedReason.averageDailyDemand} units/day</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Supplier Lead Time:</span>
                  <span className="font-semibold text-white">{selectedReason.leadTimeDays} days</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Safety Stock:</span>
                  <span className="font-semibold text-white">{selectedReason.safetyStock} units</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Reorder Point:</span>
                  <span className="font-semibold text-indigo-400">{selectedReason.reorderPoint} units</span>
                </div>
              </div>

              <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">On-hand Stock:</span>
                  <span className="text-white">{selectedReason.onHand}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Committed Reserved Stock:</span>
                  <span className="text-amber-400">-{selectedReason.reserved}</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-slate-700/60 pt-1">
                  <span className="text-slate-300">Net Available Stock:</span>
                  <span className="text-white">{selectedReason.available}</span>
                </div>
                {Boolean(selectedReason.inTransitIncoming) && (
                  <div className="flex justify-between text-blue-400">
                    <span>Incoming In-Transit:</span>
                    <span>+{selectedReason.inTransitIncoming}</span>
                  </div>
                )}
                {Boolean(selectedReason.onOrderPO) && (
                  <div className="flex justify-between text-indigo-400">
                    <span>On-Order Purchase Orders:</span>
                    <span>+{selectedReason.onOrderPO}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold border-t border-slate-700/60 pt-1">
                  <span className="text-slate-200">Raw Shortfall to Target ({selectedReason.targetStock}):</span>
                  <span className="text-rose-400">{selectedReason.rawShortfall} units</span>
                </div>
              </div>

              {selectedReason.roundingNote && (
                <div className="p-2.5 bg-indigo-950/30 border border-indigo-900/50 rounded-lg text-indigo-300 text-[11px]">
                  <strong>Packaging Rounding:</strong> {selectedReason.roundingNote}
                </div>
              )}

              <p className="text-slate-300 italic text-[11px] bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                "{selectedReason.explanation}"
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedReason(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reorder Rule Configuration Modal */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRule}
            className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl flex flex-col space-y-4 text-xs"
          >
            <div className="pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Configure Product Reorder Rule</h3>
              <p className="text-slate-400">Set safety stock, minimum threshold, and supplier lead times.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Product</label>
                <select
                  value={ruleForm.productId}
                  onChange={(e) => setRuleForm({ ...ruleForm, productId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  required
                >
                  <option value="">Select product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Stock Location (Optional - all locations if empty)</label>
                <select
                  value={ruleForm.stockLocationId}
                  onChange={(e) => setRuleForm({ ...ruleForm, stockLocationId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                >
                  <option value="">Default (All locations)</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Preferred Supplier</label>
                <select
                  value={ruleForm.preferredSupplierId}
                  onChange={(e) => setRuleForm({ ...ruleForm, preferredSupplierId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                >
                  <option value="">Unassigned</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Min Stock</label>
                  <input
                    type="number"
                    min="0"
                    value={ruleForm.minimumStock}
                    onChange={(e) => setRuleForm({ ...ruleForm, minimumStock: Number(e.target.value) })}
                    className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Reorder Point</label>
                  <input
                    type="number"
                    min="0"
                    value={ruleForm.reorderPoint}
                    onChange={(e) => setRuleForm({ ...ruleForm, reorderPoint: Number(e.target.value) })}
                    className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Target Stock</label>
                  <input
                    type="number"
                    min="1"
                    value={ruleForm.targetStock}
                    onChange={(e) => setRuleForm({ ...ruleForm, targetStock: Number(e.target.value) })}
                    className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Lead Time (Days)</label>
                  <input
                    type="number"
                    min="0"
                    value={ruleForm.leadTimeDays}
                    onChange={(e) => setRuleForm({ ...ruleForm, leadTimeDays: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Safety Stock</label>
                  <input
                    type="number"
                    min="0"
                    value={ruleForm.safetyStock}
                    onChange={(e) => setRuleForm({ ...ruleForm, safetyStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsRuleModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow-sm"
              >
                Save Rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

