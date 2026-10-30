import React, { useState, useEffect } from 'react';
import {
  ArrowRightLeft,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Truck,
  PackageCheck,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Building2,
  ChevronRight,
  ArrowRight
} from 'lucide-react';
import {
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
  StockTransferType,
  StockTransferReceipt
} from '../../../shared/types/stock-transfer';

export const StockTransfersView: React.FC = () => {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);

  // Locations & Products
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // New Transfer State
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destLocationId, setDestLocationId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [formLines, setFormLines] = useState<
    Array<{
      productId: string;
      productName: string;
      productSku: string;
      requestedQty: number;
    }>
  >([]);

  // Receive Form State
  const [receiveLines, setReceiveLines] = useState<
    Array<{
      lineId: string;
      productName: string;
      dispatchedQty: number;
      previouslyReceivedQty: number;
      remainingInTransitQty: number;
      receivedQty: number;
      rejectedQty: number;
      lossQty: number;
      discrepancyReason: string;
    }>
  >([]);
  const [receiveNotes, setReceiveNotes] = useState('');

  const businessId = '00000000-0000-0000-0000-000000000001';

  useEffect(() => {
    loadTransfers();
    loadLocations();
    loadProducts();
  }, []);

  const loadTransfers = async () => {
    setLoading(true);
    try {
      if (window.posApi?.stockTransfers?.list) {
        const res = await window.posApi.stockTransfers.list({ businessId });
        if (res.success && res.data) {
          setTransfers(res.data);
        }
      }
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async () => {
    try {
      if (window.posApi?.stockLocations?.list) {
        const res = await window.posApi.stockLocations.list({ businessId });
        const list = Array.isArray(res) ? res : (res as any)?.data || [];
        setLocations(list.filter((l: any) => l.isActive && !l.code?.startsWith('IN-TRANSIT')));
      }
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  };

  const loadProducts = async () => {
    try {
      if (window.posApi?.inventory?.listProducts) {
        const res = await window.posApi.inventory.listProducts();
        const list = Array.isArray(res) ? res : (res as any)?.data || [];
        setProducts(list.filter((p: any) => p.isActive));
      }
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  const handleOpenDetail = async (transferId: string) => {
    try {
      if (window.posApi?.stockTransfers?.getById) {
        const res = await window.posApi.stockTransfers.getById(transferId);
        if (res.success && res.data) {
          setSelectedTransfer(res.data);
          setIsDetailModalOpen(true);
        }
      }
    } catch (err) {
      console.error('Failed to get transfer details:', err);
    }
  };

  const handleCreateTransfer = async () => {
    if (!sourceLocationId || !destLocationId) {
      alert('Please select both source and destination locations.');
      return;
    }
    if (sourceLocationId === destLocationId) {
      alert('Source and destination locations cannot be the same.');
      return;
    }
    if (formLines.length === 0) {
      alert('Please add at least one product to transfer.');
      return;
    }

    try {
      const input = {
        businessId,
        sourceLocationId,
        destinationLocationId: destLocationId,
        notes: transferNotes,
        lines: formLines.map((l) => ({
          productId: l.productId,
          requestedQuantityScaled: Math.round(l.requestedQty * 1000)
        })),
        autoSubmit: true
      };

      const res = await window.posApi.stockTransfers.create(input);
      if (res.success) {
        setIsNewModalOpen(false);
        setSourceLocationId('');
        setDestLocationId('');
        setTransferNotes('');
        setFormLines([]);
        loadTransfers();
      } else {
        alert(`Error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Error creating transfer: ${err.message}`);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Are you sure you want to approve this stock transfer?')) return;
    try {
      const res = await window.posApi.stockTransfers.approve(id);
      if (res.success) {
        loadTransfers();
        handleOpenDetail(id);
      } else {
        alert(`Approval error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleOpenDispatch = (transfer: StockTransfer) => {
    setSelectedTransfer(transfer);
    setIsDispatchModalOpen(true);
  };

  const handleConfirmDispatch = async () => {
    if (!selectedTransfer) return;
    try {
      const res = await window.posApi.stockTransfers.dispatch({
        transferId: selectedTransfer.id,
        notes: 'Dispatched from inventory management'
      });
      if (res.success) {
        setIsDispatchModalOpen(false);
        loadTransfers();
        handleOpenDetail(selectedTransfer.id);
      } else {
        alert(`Dispatch error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleOpenReceive = (transfer: StockTransfer) => {
    setSelectedTransfer(transfer);
    const lines = (transfer.lines || []).map((l) => {
      const prevAccounted = (l.receivedQuantityScaled + l.rejectedQuantityScaled + l.lossQuantityScaled) / 1000;
      const dispatched = l.dispatchedQuantityScaled / 1000;
      const remaining = Math.max(0, dispatched - prevAccounted);
      return {
        lineId: l.id,
        productName: l.productName || 'Product',
        dispatchedQty: dispatched,
        previouslyReceivedQty: l.receivedQuantityScaled / 1000,
        remainingInTransitQty: remaining,
        receivedQty: remaining,
        rejectedQty: 0,
        lossQty: 0,
        discrepancyReason: ''
      };
    });
    setReceiveLines(lines);
    setReceiveNotes('');
    setIsReceiveModalOpen(true);
  };

  const handleConfirmReceive = async () => {
    if (!selectedTransfer) return;
    try {
      const input = {
        transferId: selectedTransfer.id,
        notes: receiveNotes,
        lines: receiveLines.map((l) => ({
          lineId: l.lineId,
          receivedQuantityScaled: Math.round(l.receivedQty * 1000),
          rejectedQuantityScaled: Math.round(l.rejectedQty * 1000),
          lossQuantityScaled: Math.round(l.lossQty * 1000),
          discrepancyReason: l.discrepancyReason || null
        }))
      };

      const res = await window.posApi.stockTransfers.receive(input);
      if (res.success) {
        setIsReceiveModalOpen(false);
        loadTransfers();
        handleOpenDetail(selectedTransfer.id);
      } else {
        alert(`Receive error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleCancelTransfer = async (id: string) => {
    const reason = prompt('Please provide a reason for cancelling this transfer:');
    if (!reason) return;
    try {
      const res = await window.posApi.stockTransfers.cancel(id, reason);
      if (res.success) {
        loadTransfers();
        if (selectedTransfer?.id === id) {
          handleOpenDetail(id);
        }
      } else {
        alert(`Cancel error: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Add line to new transfer form
  const handleAddProductLine = (productId: string) => {
    const prod = products.find((p) => String(p.id) === String(productId));
    if (!prod) return;
    if (formLines.some((l) => l.productId === prod.id)) return;

    setFormLines([
      ...formLines,
      {
        productId: prod.id,
        productName: prod.name,
        productSku: prod.sku,
        requestedQty: 1
      }
    ]);
  };

  const handleUpdateLineQty = (productId: string, qty: number) => {
    setFormLines(
      formLines.map((l) => (l.productId === productId ? { ...l, requestedQty: Math.max(0.001, qty) } : l))
    );
  };

  const handleRemoveLine = (productId: string) => {
    setFormLines(formLines.filter((l) => l.productId !== productId));
  };

  const getStatusBadge = (status: StockTransferStatus) => {
    switch (status) {
      case 'draft':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Draft</span>;
      case 'requested':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending Approval</span>;
      case 'approved':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Approved</span>;
      case 'dispatched':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 flex items-center gap-1"><Truck className="w-3 h-3" /> In Transit</span>;
      case 'partially_received':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Partial Receipt</span>;
      case 'received':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 flex items-center gap-1"><PackageCheck className="w-3 h-3" /> Received</span>;
      case 'cancelled':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Cancelled</span>;
      case 'rejected':
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">Rejected</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{status}</span>;
    }
  };

  const filteredTransfers = transfers.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (typeFilter !== 'ALL' && t.transferType !== typeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchNum = t.transferNumber.toLowerCase().includes(q);
      const matchSrc = (t.sourceLocationName || '').toLowerCase().includes(q);
      const matchDest = (t.destinationLocationName || '').toLowerCase().includes(q);
      if (!matchNum && !matchSrc && !matchDest) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-indigo-600" />
            Stock Transfers & Relocations
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Move inventory between storerooms, sales floors, and branches with multi-stage dispatch and in-transit tracking.
          </p>
        </div>

        <button
          onClick={() => setIsNewModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create New Transfer
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search by transfer number or location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-sm text-gray-600 font-medium">
            <Filter className="w-4 h-4" /> Filter:
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="requested">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="dispatched">In Transit</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received / Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Types</option>
            <option value="internal">Internal (Same Branch)</option>
            <option value="inter_branch">Inter-Branch</option>
          </select>
        </div>
      </div>

      {/* Transfers Data Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-500">Loading transfers...</div>
        ) : filteredTransfers.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <ArrowRightLeft className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-700">No stock transfers found</p>
            <p className="text-sm text-gray-400 mt-1">Create a new transfer to move stock between storage locations.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50/75 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-600">
                <th className="py-3 px-4">Transfer Number</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Source Location</th>
                <th className="py-3 px-4 text-center">Route</th>
                <th className="py-3 px-4">Destination Location</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTransfers.map((t) => (
                <tr key={t.id} className="hover:bg-indigo-50/30 transition-colors">
                  <td className="py-3 px-4 font-mono font-medium text-indigo-600">{t.transferNumber}</td>
                  <td className="py-3 px-4">
                    {t.transferType === 'inter_branch' ? (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        Inter-Branch
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                        Internal
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-900">{t.sourceLocationName || t.sourceLocationId}</td>
                  <td className="py-3 px-4 text-center text-gray-400">
                    <ArrowRight className="w-4 h-4 mx-auto inline" />
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-900">{t.destinationLocationName || t.destinationLocationId}</td>
                  <td className="py-3 px-4">{getStatusBadge(t.status)}</td>
                  <td className="py-3 px-4 text-gray-500">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button
                      onClick={() => handleOpenDetail(t.id)}
                      className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded"
                    >
                      View Details
                    </button>
                    {t.status === 'requested' && (
                      <button
                        onClick={() => handleApprove(t.id)}
                        className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Approve
                      </button>
                    )}
                    {(t.status === 'approved' || t.status === 'requested') && (
                      <button
                        onClick={() => handleOpenDispatch(t)}
                        className="px-2.5 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700"
                      >
                        Dispatch
                      </button>
                    )}
                    {(t.status === 'dispatched' || t.status === 'partially_received') && (
                      <button
                        onClick={() => handleOpenReceive(t)}
                        className="px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        Receive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: New Stock Transfer */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              Create Stock Transfer
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Source Location</label>
                <select
                  value={sourceLocationId}
                  onChange={(e) => setSourceLocationId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Select source...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.branchName || 'Branch'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Destination Location</label>
                <select
                  value={destLocationId}
                  onChange={(e) => setDestLocationId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Select destination...</option>
                  {locations
                    .filter((l) => l.id !== sourceLocationId)
                    .map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.branchName || 'Branch'})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Notes / Reason</label>
              <input
                type="text"
                placeholder="e.g. Replenishment from storeroom to sales floor"
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Line Items Selector */}
            <div className="border-t border-gray-200 pt-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-gray-800">Transfer Items</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) handleAddProductLine(e.target.value);
                    e.target.value = '';
                  }}
                  className="px-3 py-1.5 border border-indigo-300 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold"
                >
                  <option value="">+ Add Product Line...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              {formLines.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                  No items added yet. Click "+ Add Product Line" above.
                </div>
              ) : (
                <div className="space-y-2">
                  {formLines.map((line) => (
                    <div
                      key={line.productId}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{line.productName}</div>
                        <div className="text-xs text-gray-500 font-mono">{line.productSku}</div>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500 font-medium">Qty:</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={line.requestedQty}
                          onChange={(e) => handleUpdateLineQty(line.productId, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right font-mono"
                        />
                        <button
                          onClick={() => handleRemoveLine(line.productId)}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTransfer}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
              >
                Submit Transfer Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transfer Details */}
      {isDetailModalOpen && selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-gray-200 pb-4 mb-4">
              <div>
                <span className="font-mono text-sm font-bold text-indigo-600">{selectedTransfer.transferNumber}</span>
                <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
                  {selectedTransfer.sourceLocationName} <ArrowRight className="w-4 h-4 text-gray-400" /> {selectedTransfer.destinationLocationName}
                </h3>
                <div className="mt-1 flex items-center gap-2">
                  {getStatusBadge(selectedTransfer.status)}
                  <span className="text-xs text-gray-500">
                    Type: <strong className="capitalize">{selectedTransfer.transferType?.replace('_', ' ')}</strong>
                  </span>
                </div>
              </div>

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Audit Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-lg text-xs mb-4">
              <div>
                <span className="text-gray-400 block">Requested By</span>
                <span className="font-medium text-gray-800">{selectedTransfer.requesterName || selectedTransfer.requestedBy || 'System'}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Approved By</span>
                <span className="font-medium text-gray-800">{selectedTransfer.approverName || selectedTransfer.approvedBy || '—'}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Dispatched By</span>
                <span className="font-medium text-gray-800">{selectedTransfer.dispatcherName || selectedTransfer.dispatchedBy || '—'}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Received By</span>
                <span className="font-medium text-gray-800">{selectedTransfer.receiverName || selectedTransfer.receivedBy || '—'}</span>
              </div>
            </div>

            {/* Items Table */}
            <h4 className="text-sm font-bold text-gray-800 mb-2">Transfer Lines</h4>
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="p-2.5">Product</th>
                    <th className="p-2.5 text-right">Requested</th>
                    <th className="p-2.5 text-right">Dispatched</th>
                    <th className="p-2.5 text-right">Received</th>
                    <th className="p-2.5 text-right">Rejected</th>
                    <th className="p-2.5 text-right">Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(selectedTransfer.lines || []).map((l) => (
                    <tr key={l.id}>
                      <td className="p-2.5 font-medium text-gray-900">
                        {l.productName}
                        <span className="block text-gray-400 font-mono text-[10px]">{l.productSku}</span>
                      </td>
                      <td className="p-2.5 text-right font-mono">{l.requestedQuantityScaled / 1000}</td>
                      <td className="p-2.5 text-right font-mono font-medium text-purple-700">{l.dispatchedQuantityScaled / 1000}</td>
                      <td className="p-2.5 text-right font-mono font-medium text-emerald-700">{l.receivedQuantityScaled / 1000}</td>
                      <td className="p-2.5 text-right font-mono font-medium text-rose-700">{l.rejectedQuantityScaled / 1000}</td>
                      <td className="p-2.5 text-right font-mono font-medium text-red-700">{l.lossQuantityScaled / 1000}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Receipts Log */}
            {selectedTransfer.receipts && selectedTransfer.receipts.length > 0 && (
              <div>
                <h4 className="text-sm font-bold text-gray-800 mb-2">Receipt Audits</h4>
                <div className="space-y-2 mb-4">
                  {selectedTransfer.receipts.map((rcp) => (
                    <div key={rcp.id} className="p-3 bg-gray-50 rounded border border-gray-200 text-xs">
                      <div className="flex justify-between font-medium">
                        <span className="font-mono text-emerald-700">{rcp.receiptNumber}</span>
                        <span className="text-gray-400">{rcp.receivedAt ? new Date(rcp.receivedAt).toLocaleString() : ''}</span>
                      </div>
                      {rcp.notes && <p className="text-gray-600 mt-1 italic">{rcp.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex justify-between items-center pt-4 border-t border-gray-200">
              {['draft', 'requested', 'approved'].includes(selectedTransfer.status) ? (
                <button
                  onClick={() => handleCancelTransfer(selectedTransfer.id)}
                  className="px-3 py-1.5 text-xs text-red-600 hover:text-red-800 font-medium border border-red-200 rounded"
                >
                  Cancel Transfer
                </button>
              ) : <div />}

              <div className="space-x-2">
                {selectedTransfer.status === 'requested' && (
                  <button
                    onClick={() => handleApprove(selectedTransfer.id)}
                    className="px-4 py-2 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                  >
                    Approve Transfer
                  </button>
                )}
                {(selectedTransfer.status === 'approved' || selectedTransfer.status === 'requested') && (
                  <button
                    onClick={() => {
                      setIsDetailModalOpen(false);
                      handleOpenDispatch(selectedTransfer);
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded text-xs font-semibold hover:bg-purple-700"
                  >
                    Dispatch Stock
                  </button>
                )}
                {(selectedTransfer.status === 'dispatched' || selectedTransfer.status === 'partially_received') && (
                  <button
                    onClick={() => {
                      setIsDetailModalOpen(false);
                      handleOpenReceive(selectedTransfer);
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700"
                  >
                    Receive Delivery
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Dispatch */}
      {isDispatchModalOpen && selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Truck className="w-5 h-5 text-purple-600" />
              Confirm Stock Dispatch
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Dispatching will immediately deduct items from <strong>{selectedTransfer.sourceLocationName}</strong> and move them to the <strong>In-Transit</strong> state.
            </p>

            <div className="p-3 bg-purple-50 rounded-lg border border-purple-100 text-xs mb-4">
              <div className="font-semibold text-purple-800 mb-1">Items to be dispatched:</div>
              {(selectedTransfer.lines || []).map((l) => (
                <div key={l.id} className="flex justify-between py-0.5 text-purple-900">
                  <span>{l.productName}</span>
                  <span className="font-mono">{l.requestedQuantityScaled / 1000} units</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDispatchModalOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDispatch}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700"
              >
                Confirm Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Receive Delivery */}
      {isReceiveModalOpen && selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-emerald-600" />
              Receive Transfer Delivery
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Confirm received quantities into <strong>{selectedTransfer.destinationLocationName}</strong>. You can record rejected/damaged or missing loss quantities.
            </p>

            <div className="space-y-4 mb-4">
              {receiveLines.map((line, idx) => (
                <div key={line.lineId} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-sm text-gray-900">{line.productName}</span>
                    <span className="text-xs text-gray-500 font-mono">
                      In-Transit: <strong>{line.remainingInTransitQty}</strong> units
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-emerald-700">Accepted Qty</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={line.receivedQty}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = [...receiveLines];
                          updated[idx].receivedQty = val;
                          setReceiveLines(updated);
                        }}
                        className="w-full px-2 py-1 border border-emerald-300 rounded text-xs text-right font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-rose-700">Rejected Qty</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={line.rejectedQty}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = [...receiveLines];
                          updated[idx].rejectedQty = val;
                          setReceiveLines(updated);
                        }}
                        className="w-full px-2 py-1 border border-rose-300 rounded text-xs text-right font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-red-700">Loss / Missing</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={line.lossQty}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = [...receiveLines];
                          updated[idx].lossQty = val;
                          setReceiveLines(updated);
                        }}
                        className="w-full px-2 py-1 border border-red-300 rounded text-xs text-right font-mono"
                      />
                    </div>
                  </div>

                  {(line.rejectedQty > 0 || line.lossQty > 0) && (
                    <div className="mt-2">
                      <input
                        type="text"
                        placeholder="Discrepancy / rejection reason (e.g. Broken packaging)"
                        value={line.discrepancyReason}
                        onChange={(e) => {
                          const updated = [...receiveLines];
                          updated[idx].discrepancyReason = e.target.value;
                          setReceiveLines(updated);
                        }}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Receipt Notes</label>
              <input
                type="text"
                placeholder="Optional delivery notes"
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsReceiveModalOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReceive}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
              >
                Confirm Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
