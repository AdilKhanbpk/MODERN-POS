import React, { useState, useEffect } from 'react';
import {
  FileCheck2,
  Search,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  PackageCheck,
  AlertTriangle,
  XCircle,
  Eye,
  Sliders,
  DollarSign,
  Truck,
  Building2,
  ShieldAlert,
  ArrowRight,
  ClipboardList,
  Sparkles
} from 'lucide-react';
import {
  GoodsReceipt,
  GoodsReceiptLine,
  GoodsReceiptStatus,
  GoodsReceiptDiscrepancyReportItem,
  GoodsReceiptDiscrepancyType
} from '../../../shared/types/goods-receipt';
import { PurchaseOrder } from '../../../shared/types/purchase-order';

export const GoodsReceiptsView: React.FC = () => {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [discrepancyReport, setDiscrepancyReport] = useState<GoodsReceiptDiscrepancyReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'receipts' | 'discrepancies'>('receipts');

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [approvedPOs, setApprovedPOs] = useState<PurchaseOrder[]>([]);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceipt | null>(null);

  // Form State
  const [formPOId, setFormPOId] = useState<string>('');
  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formLocationId, setFormLocationId] = useState<string>('');
  const [formDeliveryNote, setFormDeliveryNote] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formLines, setFormLines] = useState<Array<{
    productId: string;
    productName: string;
    purchaseOrderLineId?: string;
    purchaseUnitId: string;
    conversionNumerator: number;
    conversionDenominator: number;
    receivedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    damagedQuantity: number;
    unitCostMinor: number;
    batchNumber?: string;
    expiryDate?: string;
    serialNumbersText?: string;
    discrepancyType?: GoodsReceiptDiscrepancyType;
    discrepancyReason?: string;
  }>>([]);

  const businessId = '00000000-0000-0000-0000-000000000001';

  const loadData = async () => {
    try {
      setLoading(true);
      const api = (window as any).posApi;
      if (!api) return;

      const [suppList, prodList, locList, poRes] = await Promise.all([
        api.suppliers?.list ? api.suppliers.list() : [],
        api.inventory?.listProducts ? api.inventory.listProducts() : [],
        api.stockLocations?.listLocations ? api.stockLocations.listLocations(businessId) : [],
        api.purchaseOrders?.search ? api.purchaseOrders.search({ businessId, status: ['approved', 'sent', 'partially_received'] }) : { orders: [] }
      ]);

      setSuppliers(suppList || []);
      setProducts(prodList || []);
      setLocations(locList || []);
      setApprovedPOs(poRes?.orders || []);

      if (locList && locList.length > 0 && !formLocationId) {
        setFormLocationId(locList[0].id);
      }
      if (suppList && suppList.length > 0 && !formSupplierId) {
        setFormSupplierId(suppList[0].id);
      }

      await loadReceipts();
    } catch (err) {
      console.error('[GoodsReceiptsView loadData error]:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadReceipts = async () => {
    const api = (window as any).posApi;
    if (!api?.goodsReceipts) return;

    try {
      const res = await api.goodsReceipts.search({
        businessId,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery || undefined
      });
      setReceipts(res?.receipts || []);

      const discRes = await api.goodsReceipts.getDiscrepancyReport(businessId);
      setDiscrepancyReport(discRes || []);
    } catch (err) {
      console.error('[GoodsReceiptsView loadReceipts error]:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadReceipts();
  }, [statusFilter, searchQuery]);

  const handleSelectPO = (poId: string) => {
    setFormPOId(poId);
    if (!poId) {
      setFormLines([]);
      return;
    }
    const po = approvedPOs.find((p) => p.id === poId);
    if (!po) return;

    setFormSupplierId(po.supplierId);

    const initialLines = (po.lines || []).map((l) => {
      const remainingScaled = Math.max(0, l.orderedQuantityScaled - (l.receivedQuantityScaled || 0));
      const remainingUnits = remainingScaled / 1000;
      return {
        productId: l.productId,
        productName: l.productName || 'Product',
        purchaseOrderLineId: l.id,
        purchaseUnitId: l.purchaseUnitId,
        conversionNumerator: l.conversionNumerator,
        conversionDenominator: l.conversionDenominator,
        receivedQuantity: remainingUnits,
        acceptedQuantity: remainingUnits,
        rejectedQuantity: 0,
        damagedQuantity: 0,
        unitCostMinor: l.unitPriceMinor
      };
    });
    setFormLines(initialLines);
  };

  const handleAddDirectLine = () => {
    if (products.length === 0) return;
    const prod = products[0];
    setFormLines((prev) => [
      ...prev,
      {
        productId: String(prod.id),
        productName: prod.name,
        purchaseUnitId: String(prod.baseUnitId || '1'),
        conversionNumerator: 1,
        conversionDenominator: 1,
        receivedQuantity: 10,
        acceptedQuantity: 10,
        rejectedQuantity: 0,
        damagedQuantity: 0,
        unitCostMinor: prod.costPrice ? prod.costPrice * 100 : 1000
      }
    ]);
  };

  const handleUpdateLine = (index: number, field: string, value: any) => {
    setFormLines((prev) => {
      const next = [...prev];
      const target = { ...next[index], [field]: value };

      if (field === 'productId') {
        const prod = products.find((p) => String(p.id) === String(value));
        if (prod) {
          target.productName = prod.name;
          target.purchaseUnitId = String(prod.baseUnitId || '1');
          target.unitCostMinor = prod.costPrice ? prod.costPrice * 100 : 1000;
        }
      }

      next[index] = target;
      return next;
    });
  };

  const handleRemoveLine = (index: number) => {
    setFormLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateGRN = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = (window as any).posApi;
    if (!api?.goodsReceipts) return;

    if (formLines.length === 0) {
      alert('Please add at least one received product line.');
      return;
    }

    // Validate invariant on each line: Received = Accepted + Rejected + Damaged
    for (let i = 0; i < formLines.length; i++) {
      const l = formLines[i];
      const sum = Number(l.acceptedQuantity) + Number(l.rejectedQuantity) + Number(l.damagedQuantity);
      if (Math.round(sum * 1000) !== Math.round(Number(l.receivedQuantity) * 1000)) {
        alert(
          `Line ${i + 1} (${l.productName}) is inconsistent!\nPhysically Received (${l.receivedQuantity}) must equal Accepted (${l.acceptedQuantity}) + Rejected (${l.rejectedQuantity}) + Damaged (${l.damagedQuantity}). Sum is ${sum}.`
        );
        return;
      }
    }

    try {
      const input = {
        businessId,
        purchaseOrderId: formPOId || null,
        supplierId: formSupplierId,
        stockLocationId: formLocationId,
        supplierDeliveryNote: formDeliveryNote || null,
        notes: formNotes || null,
        lines: formLines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId || null,
          productId: l.productId,
          purchaseUnitId: l.purchaseUnitId,
          conversionNumerator: l.conversionNumerator,
          conversionDenominator: l.conversionDenominator,
          receivedQuantityScaled: Math.round(l.receivedQuantity * 1000),
          acceptedQuantityScaled: Math.round(l.acceptedQuantity * 1000),
          rejectedQuantityScaled: Math.round(l.rejectedQuantity * 1000),
          damagedQuantityScaled: Math.round(l.damagedQuantity * 1000),
          unitCostMinor: l.unitCostMinor,
          batchNumber: l.batchNumber || null,
          expiryDate: l.expiryDate || null,
          discrepancyType: l.discrepancyType || null,
          discrepancyReason: l.discrepancyReason || null,
          serials: l.serialNumbersText
            ? l.serialNumbersText.split(',').map((s) => ({
                serialNumber: s.trim(),
                condition: 'accepted' as const
              })).filter((s) => Boolean(s.serialNumber))
            : undefined
        }))
      };

      const actor = { userId: '1', role: 'admin', businessId };
      await api.goodsReceipts.createReceipt(input, actor);

      setIsCreateModalOpen(false);
      setFormPOId('');
      setFormDeliveryNote('');
      setFormNotes('');
      setFormLines([]);
      await loadReceipts();
    } catch (err: any) {
      alert(`Error creating Goods Receiving Note: ${err.message}`);
    }
  };

  const handleApprove = async (receiptId: string) => {
    const api = (window as any).posApi;
    if (!api?.goodsReceipts) return;
    try {
      const actor = { userId: '1', role: 'manager', businessId };
      await api.goodsReceipts.approveReceipt(receiptId, actor);
      await loadReceipts();
      if (selectedReceipt?.id === receiptId) {
        setSelectedReceipt(await api.goodsReceipts.getById(receiptId, businessId));
      }
    } catch (err: any) {
      alert(`Error approving GRN: ${err.message}`);
    }
  };

  const handlePost = async (receiptId: string) => {
    const api = (window as any).posApi;
    if (!api?.goodsReceipts) return;
    if (!confirm('Are you sure you want to POST this Goods Receiving Note? This will permanently increase physical stock and write movement ledger audit records.')) {
      return;
    }

    try {
      const actor = { userId: '1', role: 'manager', businessId };
      await api.goodsReceipts.postReceipt({ goodsReceiptId: receiptId, managerApproved: true }, actor);
      await loadReceipts();
      if (selectedReceipt?.id === receiptId) {
        setSelectedReceipt(await api.goodsReceipts.getById(receiptId, businessId));
      }
      alert('Goods Receiving Note successfully posted into inventory!');
    } catch (err: any) {
      alert(`Error posting GRN: ${err.message}`);
    }
  };

  const handleCancel = async (receiptId: string) => {
    const reason = prompt('Please enter reason for cancelling this Goods Receiving Note:');
    if (!reason) return;

    const api = (window as any).posApi;
    if (!api?.goodsReceipts) return;
    try {
      const actor = { userId: '1', role: 'manager', businessId };
      await api.goodsReceipts.cancelReceipt(receiptId, reason, actor);
      await loadReceipts();
      if (selectedReceipt?.id === receiptId) {
        setSelectedReceipt(await api.goodsReceipts.getById(receiptId, businessId));
      }
    } catch (err: any) {
      alert(`Error cancelling GRN: ${err.message}`);
    }
  };

  const getStatusBadge = (status: GoodsReceiptStatus) => {
    switch (status) {
      case 'draft':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/30">DRAFT</span>;
      case 'pending_inspection':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">PENDING INSPECTION</span>;
      case 'approved':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">APPROVED</span>;
      case 'posted':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">POSTED (IN STOCK)</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">CANCELLED</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Subheader and Controls */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setActiveTab('receipts')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'receipts' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Receiving Notes</span>
              <span className="ml-1 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded-full text-slate-300">
                {receipts.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('discrepancies')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'discrepancies' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Discrepancies & Quarantine</span>
              {discrepancyReport.length > 0 && (
                <span className="ml-1 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
                  {discrepancyReport.length}
                </span>
              )}
            </button>
          </div>

          <div className="relative ml-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search GRN #, delivery note, supplier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 w-64 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_inspection">Pending Inspection</option>
            <option value="approved">Approved</option>
            <option value="posted">Posted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setFormPOId('');
              setFormLines([]);
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Receive Inbound Goods (GRN)</span>
          </button>
          <button
            onClick={loadData}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'receipts' ? (
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0 z-10">
              <tr>
                <th className="p-3">GRN #</th>
                <th className="p-3">Reference PO</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Delivery Note #</th>
                <th className="p-3">Location</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Items Breakdown</th>
                <th className="p-3">Received At</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    No Goods Receiving Notes found. Click "Receive Inbound Goods (GRN)" to log arriving shipments.
                  </td>
                </tr>
              ) : (
                receipts.map((gr) => {
                  const lineCount = gr.lines?.length || 0;
                  const totalAccepted = (gr.lines || []).reduce((acc, l) => acc + l.acceptedQuantityScaled, 0) / 1000;
                  const totalDamaged = (gr.lines || []).reduce((acc, l) => acc + l.damagedQuantityScaled, 0) / 1000;
                  const totalRejected = (gr.lines || []).reduce((acc, l) => acc + l.rejectedQuantityScaled, 0) / 1000;

                  return (
                    <tr key={gr.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3 font-mono font-bold text-white flex items-center gap-1.5">
                        <FileCheck2 className="w-3.5 h-3.5 text-blue-400" />
                        <span>{gr.receiptNumber}</span>
                      </td>
                      <td className="p-3 text-slate-300 font-mono text-[11px]">
                        {gr.purchaseOrderNumber ? (
                          <span className="text-blue-400 underline cursor-pointer">{gr.purchaseOrderNumber}</span>
                        ) : (
                          <span className="text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">Direct Receipt</span>
                        )}
                      </td>
                      <td className="p-3 text-white font-medium">{gr.supplierName}</td>
                      <td className="p-3 text-slate-400 font-mono text-[11px]">{gr.supplierDeliveryNote || '—'}</td>
                      <td className="p-3 text-slate-300">{gr.stockLocationName}</td>
                      <td className="p-3 text-center">{getStatusBadge(gr.status)}</td>
                      <td className="p-3 text-right font-mono text-[11px]">
                        <span className="text-emerald-400">{totalAccepted} accepted</span>
                        {totalDamaged > 0 && <span className="text-rose-400 ml-1.5">({totalDamaged} dmg)</span>}
                        {totalRejected > 0 && <span className="text-amber-400 ml-1.5">({totalRejected} rej)</span>}
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-[11px]">
                        {new Date(gr.receivedAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedReceipt(gr);
                              setIsDetailModalOpen(true);
                            }}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium transition"
                            title="View Full Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {gr.status === 'draft' && (
                            <button
                              onClick={() => handleApprove(gr.id)}
                              className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/30 rounded-lg text-[11px] font-medium transition"
                            >
                              Approve
                            </button>
                          )}
                          {gr.status === 'approved' && (
                            <button
                              onClick={() => handlePost(gr.id)}
                              className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 rounded-lg text-[11px] font-medium transition flex items-center gap-1"
                            >
                              <PackageCheck className="w-3 h-3" />
                              <span>Post to Stock</span>
                            </button>
                          )}
                          {['draft', 'pending_inspection', 'approved'].includes(gr.status) && (
                            <button
                              onClick={() => handleCancel(gr.id)}
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-[11px] transition"
                              title="Cancel Receipt"
                            >
                              <XCircle className="w-3.5 h-3.5" />
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
      ) : (
        /* Discrepancies & Quarantine Report Tab */
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Receiving Discrepancies, Damage & Quarantine Log</span>
              </h3>
              <p className="text-xs text-slate-400">
                Detailed audit trail of arriving shortages, damaged packaging, rejections, and supplier variances.
              </p>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Total Recorded Discrepancies: <span className="font-bold text-white">{discrepancyReport.length}</span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-2.5">GRN #</th>
                <th className="p-2.5">PO Ref</th>
                <th className="p-2.5">Supplier</th>
                <th className="p-2.5">Product</th>
                <th className="p-2.5 text-center">Discrepancy Type</th>
                <th className="p-2.5 text-right font-mono">Physically Recv</th>
                <th className="p-2.5 text-right font-mono">Accepted</th>
                <th className="p-2.5 text-right font-mono text-rose-400">Damaged</th>
                <th className="p-2.5 text-right font-mono text-amber-400">Rejected</th>
                <th className="p-2.5 text-right font-mono">Impact (Rs.)</th>
                <th className="p-2.5">Explanation Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {discrepancyReport.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    No discrepancies recorded! All arriving goods have matched expected purchase orders with zero damaged or rejected units.
                  </td>
                </tr>
              ) : (
                discrepancyReport.map((d, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="p-2.5 font-mono font-bold text-white">{d.receiptNumber}</td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-400">{d.purchaseOrderNumber || 'Direct'}</td>
                    <td className="p-2.5 text-white">{d.supplierName}</td>
                    <td className="p-2.5 text-slate-200">{d.productName}</td>
                    <td className="p-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        {d.discrepancyType.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-mono">{d.receivedQuantityScaled / 1000}</td>
                    <td className="p-2.5 text-right font-mono text-emerald-400">{d.acceptedQuantityScaled / 1000}</td>
                    <td className="p-2.5 text-right font-mono text-rose-400 font-bold">{d.damagedQuantityScaled / 1000}</td>
                    <td className="p-2.5 text-right font-mono text-amber-400 font-bold">{d.rejectedQuantityScaled / 1000}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-white">
                      Rs. {(d.financialImpactMinor / 100).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-slate-400 text-[11px]">{d.discrepancyReason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE GRN MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl max-h-[90vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <PackageCheck className="w-5 h-5 text-blue-400" />
                  <span>Receive Inbound Goods (GRN)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Record what was physically delivered, distinguishing accepted sellable goods from damaged or rejected items.
                </p>
              </div>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGRN} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                {/* Header Inputs */}
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Purchase Order (Optional)</label>
                    <select
                      value={formPOId}
                      onChange={(e) => handleSelectPO(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    >
                      <option value="">— Direct Receipt (No PO) —</option>
                      {approvedPOs.map((po) => (
                        <option key={po.id} value={po.id}>
                          {po.purchaseOrderNumber} ({po.supplierName})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Supplier</label>
                    <select
                      value={formSupplierId}
                      onChange={(e) => setFormSupplierId(e.target.value)}
                      disabled={Boolean(formPOId)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white disabled:opacity-50"
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.supplier_code || s.supplierCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Receiving Stock Location</label>
                    <select
                      value={formLocationId}
                      onChange={(e) => setFormLocationId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    >
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.location_type || loc.locationType})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Supplier Delivery Note #</label>
                    <input
                      type="text"
                      placeholder="e.g. DN-88192"
                      value={formDeliveryNote}
                      onChange={(e) => setFormDeliveryNote(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>

                {/* Line Items Table with Quantity Invariant Validation */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Received Product Lines</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        (Formula: Physically Received = Accepted + Rejected + Damaged)
                      </span>
                    </h4>
                    {!formPOId && (
                      <button
                        type="button"
                        onClick={handleAddDirectLine}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-semibold rounded-lg transition"
                      >
                        + Add Product Line
                      </button>
                    )}
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                        <tr>
                          <th className="p-2.5">Product</th>
                          <th className="p-2.5 text-right w-24">Phys. Recv</th>
                          <th className="p-2.5 text-right w-24 text-emerald-400">Accepted</th>
                          <th className="p-2.5 text-right w-24 text-rose-400">Damaged</th>
                          <th className="p-2.5 text-right w-24 text-amber-400">Rejected</th>
                          <th className="p-2.5 text-center w-28">Invariant Check</th>
                          <th className="p-2.5">Batch / Serials</th>
                          <th className="p-2.5 text-center w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {formLines.map((line, idx) => {
                          const sum = Number(line.acceptedQuantity) + Number(line.rejectedQuantity) + Number(line.damagedQuantity);
                          const isConsistent = Math.round(sum * 1000) === Math.round(Number(line.receivedQuantity) * 1000);

                          return (
                            <tr key={idx} className="hover:bg-slate-900/40">
                              <td className="p-2.5">
                                {!line.purchaseOrderLineId ? (
                                  <select
                                    value={line.productId}
                                    onChange={(e) => handleUpdateLine(idx, 'productId', e.target.value)}
                                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-xs w-full"
                                  >
                                    {products.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div>
                                    <div className="font-bold text-white">{line.productName}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">PO Ref Item</div>
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={line.receivedQuantity}
                                  onChange={(e) => handleUpdateLine(idx, 'receivedQuantity', parseFloat(e.target.value) || 0)}
                                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-white font-mono font-bold"
                                />
                              </td>
                              <td className="p-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={line.acceptedQuantity}
                                  onChange={(e) => handleUpdateLine(idx, 'acceptedQuantity', parseFloat(e.target.value) || 0)}
                                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-emerald-400 font-mono font-bold"
                                />
                              </td>
                              <td className="p-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={line.damagedQuantity}
                                  onChange={(e) => handleUpdateLine(idx, 'damagedQuantity', parseFloat(e.target.value) || 0)}
                                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-rose-400 font-mono"
                                />
                              </td>
                              <td className="p-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={line.rejectedQuantity}
                                  onChange={(e) => handleUpdateLine(idx, 'rejectedQuantity', parseFloat(e.target.value) || 0)}
                                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-amber-400 font-mono"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                {isConsistent ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                                    <CheckCircle2 className="w-3 h-3" /> Exact
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/30" title={`Sum is ${sum}, Expected ${line.receivedQuantity}`}>
                                    <AlertTriangle className="w-3 h-3" /> {sum > line.receivedQuantity ? `+${sum - line.receivedQuantity}` : `-${line.receivedQuantity - sum}`}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5">
                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    placeholder="Batch # (if batch tracked)"
                                    value={line.batchNumber || ''}
                                    onChange={(e) => handleUpdateLine(idx, 'batchNumber', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Serials (comma separated)"
                                    value={line.serialNumbersText || ''}
                                    onChange={(e) => handleUpdateLine(idx, 'serialNumbersText', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white font-mono"
                                  />
                                </div>
                              </td>
                              <td className="p-2.5 text-center">
                                {!line.purchaseOrderLineId && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveLine(idx)}
                                    className="text-slate-500 hover:text-rose-400 transition"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 text-xs">Receiving Notes / Discrepancy Remarks</label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="e.g. Arrived in good condition; 3 units crushed in shipping carton; supplier notified."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white placeholder-slate-500"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  Total Items: <span className="font-bold text-white">{formLines.length}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm transition"
                  >
                    Save Goods Receiving Note
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {isDetailModalOpen && selectedReceipt && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl max-h-[85vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-blue-400" />
                  <span>Goods Receiving Note: {selectedReceipt.receiptNumber}</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Received on {new Date(selectedReceipt.receivedAt).toLocaleString()} by {selectedReceipt.receivedByName || 'Warehouse Clerk'}
                </p>
              </div>
              <button onClick={() => setIsDetailModalOpen(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="grid grid-cols-3 gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Supplier</span>
                  <span className="text-white font-bold">{selectedReceipt.supplierName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <div>{getStatusBadge(selectedReceipt.status)}</div>
                </div>
                <div>
                  <span className="text-slate-500 block">Stock Location</span>
                  <span className="text-white font-medium">{selectedReceipt.stockLocationName}</span>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-white mb-2">Physically Received Line Items</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="p-2.5">Product</th>
                        <th className="p-2.5 text-right font-mono">Recv</th>
                        <th className="p-2.5 text-right font-mono text-emerald-400">Accepted</th>
                        <th className="p-2.5 text-right font-mono text-rose-400">Damaged</th>
                        <th className="p-2.5 text-right font-mono text-amber-400">Rejected</th>
                        <th className="p-2.5">Batch / Serials</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(selectedReceipt.lines || []).map((line) => (
                        <tr key={line.id}>
                          <td className="p-2.5 text-white font-medium">{line.productName}</td>
                          <td className="p-2.5 text-right font-mono">{line.receivedQuantityScaled / 1000}</td>
                          <td className="p-2.5 text-right font-mono text-emerald-400 font-bold">{line.acceptedQuantityScaled / 1000}</td>
                          <td className="p-2.5 text-right font-mono text-rose-400">{line.damagedQuantityScaled / 1000}</td>
                          <td className="p-2.5 text-right font-mono text-amber-400">{line.rejectedQuantityScaled / 1000}</td>
                          <td className="p-2.5 text-slate-400 text-[11px]">
                            {line.batchNumber && <div>Batch: {line.batchNumber}</div>}
                            {line.serials && line.serials.length > 0 && (
                              <div className="font-mono text-[10px] text-blue-300">
                                {line.serials.map((s) => s.serialNumber).join(', ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedReceipt.notes && (
                <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[11px] mb-1">Remarks & Inspection Notes</span>
                  <p className="text-slate-300">{selectedReceipt.notes}</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                {selectedReceipt.postedAt && (
                  <span className="text-emerald-400">
                    Posted on {new Date(selectedReceipt.postedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {selectedReceipt.status === 'draft' && (
                  <button
                    onClick={() => handleApprove(selectedReceipt.id)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
                  >
                    Approve Receipt
                  </button>
                )}
                {selectedReceipt.status === 'approved' && (
                  <button
                    onClick={() => handlePost(selectedReceipt.id)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition"
                  >
                    Post to Available Stock
                  </button>
                )}
                <button
                  onClick={() => setIsDetailModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

