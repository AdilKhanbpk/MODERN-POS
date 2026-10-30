import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Search,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  FileText,
  User,
  Package,
  Layers,
  ChevronRight,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import {
  StockReservation,
  StockReservationStatus,
  StockReservationSourceType
} from '../../../shared/types/stock-reservation';

export const StockReservationsView: React.FC = () => {
  const [reservations, setReservations] = useState<StockReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReservation, setSelectedReservation] = useState<StockReservation | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [extendingId, setExtendingId] = useState<string | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState({
    sourceType: 'manual' as StockReservationSourceType,
    customerId: '',
    expiresAt: '',
    productId: '',
    stockLocationId: '',
    reservedQuantity: 1
  });

  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '11111111-1111-1111-1111-111111111111';

  const loadReservations = async () => {
    try {
      setLoading(true);
      if ((window as any).posApi?.reservations) {
        // Proactively check expired first
        await (window as any).posApi.reservations.checkExpired(businessId);
        const list = await (window as any).posApi.reservations.list({
          businessId,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          sourceType: sourceFilter !== 'all' ? sourceFilter : undefined,
          search: searchQuery || undefined
        });
        setReservations(list || []);
      }
    } catch (err) {
      console.error('Failed to load reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadReferenceData = async () => {
    try {
      if ((window as any).posApi?.inventory) {
        const prodList = await (window as any).posApi.inventory.listProducts();
        setProducts(prodList || []);
      }
      if ((window as any).posApi?.stockLocations) {
        const locList = await (window as any).posApi.stockLocations.list(businessId);
        setLocations(locList || []);
      }
      if ((window as any).posApi?.customers) {
        const custList = await (window as any).posApi.customers.list(businessId);
        setCustomers(custList || []);
      }
    } catch (err) {
      console.error('Failed to load reference data:', err);
    }
  };

  useEffect(() => {
    loadReservations();
  }, [statusFilter, sourceFilter]);

  useEffect(() => {
    loadReferenceData();
  }, []);

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!createForm.productId || !createForm.stockLocationId || createForm.reservedQuantity <= 0) {
        alert('Please select a product, stock location, and valid quantity.');
        return;
      }

      await (window as any).posApi.reservations.create({
        businessId,
        branchId,
        customerId: createForm.customerId || null,
        sourceType: createForm.sourceType,
        expiresAt: createForm.expiresAt ? new Date(createForm.expiresAt).toISOString() : null,
        lines: [
          {
            productId: createForm.productId,
            stockLocationId: createForm.stockLocationId,
            reservedQuantityScaled: Math.round(createForm.reservedQuantity * 1000)
          }
        ]
      });

      setIsCreateModalOpen(false);
      setCreateForm({
        sourceType: 'manual',
        customerId: '',
        expiresAt: '',
        productId: '',
        stockLocationId: '',
        reservedQuantity: 1
      });
      loadReservations();
    } catch (err: any) {
      alert(`Reservation error: ${err.message}`);
    }
  };

  const handleRelease = async (res: StockReservation) => {
    if (!confirm(`Are you sure you want to release unfulfilled reserved stock for "${res.reservationNumber}"?`)) {
      return;
    }
    try {
      await (window as any).posApi.reservations.release({ reservationId: res.id });
      loadReservations();
      if (selectedReservation?.id === res.id) {
        setSelectedReservation(null);
      }
    } catch (err: any) {
      alert(`Release error: ${err.message}`);
    }
  };

  const handleCancel = async (res: StockReservation) => {
    const reason = prompt(`Cancellation reason for ${res.reservationNumber}:`, 'Customer order cancelled');
    if (reason === null) return;
    try {
      await (window as any).posApi.reservations.cancel(res.id, reason);
      loadReservations();
      if (selectedReservation?.id === res.id) {
        setSelectedReservation(null);
      }
    } catch (err: any) {
      alert(`Cancellation error: ${err.message}`);
    }
  };

  const handleExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendingId || !newExpiryDate) return;
    try {
      await (window as any).posApi.reservations.extend({
        reservationId: extendingId,
        newExpiresAt: new Date(newExpiryDate).toISOString(),
        authorizedBy: 'Store Manager'
      });
      setIsExtendModalOpen(false);
      setExtendingId(null);
      setNewExpiryDate('');
      loadReservations();
    } catch (err: any) {
      alert(`Extension error: ${err.message}`);
    }
  };

  const getStatusBadge = (status: StockReservationStatus) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>;
      case 'partially_fulfilled':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">Partially Fulfilled</span>;
      case 'fulfilled':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30">Fulfilled</span>;
      case 'expired':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">Expired</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-700 text-slate-300">{status}</span>;
    }
  };

  const activeCount = reservations.filter(r => r.status === 'active' || r.status === 'partially_fulfilled').length;
  const expiredCount = reservations.filter(r => r.status === 'expired').length;

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Header & Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" />
            Stock Reservations & Committed Inventory
          </h2>
          <p className="text-xs text-slate-400">
            Commit inventory for orders, quotations, and customers without immediate sale. Available = On-Hand - Active Reserved.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <span className="text-slate-400">Active Commitments:</span>
            <span className="font-bold text-emerald-400">{activeCount}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <span className="text-slate-400">Expired:</span>
            <span className="font-bold text-amber-400">{expiredCount}</span>
          </div>
          <button
            onClick={() => loadReservations()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Sweep & Refresh
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" /> New Reservation
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search reservation # or customer name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadReservations()}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="partially_fulfilled">Partially Fulfilled</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
        >
          <option value="all">All Sources</option>
          <option value="quotation">Quotation</option>
          <option value="sales_order">Sales Order</option>
          <option value="manual">Manual</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-800 bg-slate-900/50">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Reservation #</th>
              <th className="px-4 py-3">Customer / Source</th>
              <th className="px-4 py-3">Committed Lines</th>
              <th className="px-4 py-3">Total Quantity</th>
              <th className="px-4 py-3">Reserved At</th>
              <th className="px-4 py-3">Expires At</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-500">
                  Loading stock reservations...
                </td>
              </tr>
            ) : reservations.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-500">
                  No stock reservations found.
                </td>
              </tr>
            ) : (
              reservations.map((res) => {
                const totalReserved = (res.lines || []).reduce((sum, l) => sum + l.reservedQuantityScaled / 1000, 0);
                const totalFulfilled = (res.lines || []).reduce((sum, l) => sum + l.fulfilledQuantityScaled / 1000, 0);
                const totalReleased = (res.lines || []).reduce((sum, l) => sum + l.releasedQuantityScaled / 1000, 0);
                const remaining = Math.max(0, totalReserved - totalFulfilled - totalReleased);

                const isExpired = res.status === 'expired';
                const isActive = res.status === 'active' || res.status === 'partially_fulfilled';

                return (
                  <tr key={res.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-semibold text-white">
                      {res.reservationNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200">{res.customerName || 'Walk-in / Unassigned'}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{res.sourceType}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {res.lines?.length || 0} line(s)
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-white">{totalReserved}</span>
                      <span className="text-[11px] text-slate-400 ml-1">
                        ({remaining} remaining)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {res.reservedAt ? new Date(res.reservedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {res.expiresAt ? (
                        <span className={new Date(res.expiresAt).getTime() < Date.now() ? 'text-amber-400 font-medium' : ''}>
                          {new Date(res.expiresAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-slate-500">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(res.status)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedReservation(res)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition"
                        >
                          Details
                        </button>
                        {isActive && (
                          <>
                            <button
                              onClick={() => handleRelease(res)}
                              className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-[11px] transition"
                              title="Release committed stock"
                            >
                              Release
                            </button>
                            <button
                              onClick={() => handleCancel(res)}
                              className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded text-[11px] transition"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {(isActive || isExpired) && (
                          <button
                            onClick={() => {
                              setExtendingId(res.id);
                              setIsExtendModalOpen(true);
                            }}
                            className="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded text-[11px] transition"
                          >
                            Extend
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

      {/* Details Drawer / Modal */}
      {selectedReservation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  Reservation {selectedReservation.reservationNumber}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedReservation.customerName || 'Unassigned'} • Source: {selectedReservation.sourceType}
                </p>
              </div>
              <div>{getStatusBadge(selectedReservation.status)}</div>
            </div>

            <div className="overflow-auto max-h-[300px] border border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Reserved</th>
                    <th className="px-3 py-2">Fulfilled</th>
                    <th className="px-3 py-2">Released</th>
                    <th className="px-3 py-2">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {(selectedReservation.lines || []).map((line) => {
                    const res = line.reservedQuantityScaled / 1000;
                    const ful = line.fulfilledQuantityScaled / 1000;
                    const rel = line.releasedQuantityScaled / 1000;
                    const rem = Math.max(0, res - ful - rel);
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium text-white">{line.productName || line.productId}</td>
                        <td className="px-3 py-2 text-slate-400">{line.locationName || line.stockLocationId}</td>
                        <td className="px-3 py-2 font-semibold text-white">{res}</td>
                        <td className="px-3 py-2 text-blue-400">{ful}</td>
                        <td className="px-3 py-2 text-slate-400">{rel}</td>
                        <td className="px-3 py-2 font-semibold text-emerald-400">{rem}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedReservation(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Reservation Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateReservation}
            className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl flex flex-col space-y-4 text-xs"
          >
            <div className="pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Create Stock Reservation</h3>
              <p className="text-slate-400">Commit stock to guarantee availability for orders or quotations.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Source Type</label>
                <select
                  value={createForm.sourceType}
                  onChange={(e) => setCreateForm({ ...createForm, sourceType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                >
                  <option value="manual">Manual Reservation</option>
                  <option value="quotation">From Quotation</option>
                  <option value="sales_order">From Sales Order</option>
                  <option value="other">Other Business Purpose</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Customer (Optional)</label>
                <select
                  value={createForm.customerId}
                  onChange={(e) => setCreateForm({ ...createForm, customerId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                >
                  <option value="">Unassigned / Walk-in</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.customerCode})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Product</label>
                <select
                  value={createForm.productId}
                  onChange={(e) => setCreateForm({ ...createForm, productId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  required
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Stock Location</label>
                <select
                  value={createForm.stockLocationId}
                  onChange={(e) => setCreateForm({ ...createForm, stockLocationId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  required
                >
                  <option value="">Select location...</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={createForm.reservedQuantity}
                    onChange={(e) => setCreateForm({ ...createForm, reservedQuantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Expires At (Optional)</label>
                  <input
                    type="date"
                    value={createForm.expiresAt}
                    onChange={(e) => setCreateForm({ ...createForm, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-sm"
              >
                Create Reservation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Extend Expiry Modal */}
      {isExtendModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleExtend}
            className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 shadow-2xl flex flex-col space-y-4 text-xs"
          >
            <div className="pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Extend Reservation Expiry</h3>
              <p className="text-slate-400">Re-commits or extends reserved stock until the new expiration date.</p>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">New Expiration Date</label>
              <input
                type="date"
                value={newExpiryDate}
                onChange={(e) => setNewExpiryDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white font-medium"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsExtendModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-sm"
              >
                Confirm Extension
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

