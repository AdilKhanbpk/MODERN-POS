import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  Clock,
  Ban,
  DollarSign,
  Download,
  Eye,
  Check,
  CreditCard
} from 'lucide-react';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  ThreeWayMatchReport
} from '../../../shared/types/purchase-invoice';

export const PurchaseInvoicesView: React.FC = () => {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [matchReport, setMatchReport] = useState<ThreeWayMatchReport | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<string>('CASH');

  const businessId = '00000000-0000-0000-0000-000000000001';
  const branchId = '00000000-0000-0000-0000-000000000002';
  const currentActor = { userId: '1', role: 'manager', businessId };

  const loadInvoices = async () => {
    try {
      setLoading(true);
      if (window.posApi?.purchaseInvoices) {
        const filter: any = { businessId };
        if (statusFilter !== 'all') filter.status = statusFilter;
        if (searchTerm) filter.searchTerm = searchTerm;

        const res = await window.posApi.purchaseInvoices.listInvoices(filter);
        setInvoices(res.invoices || []);
      }
    } catch (err) {
      console.error('Failed to load purchase invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [statusFilter, searchTerm]);

  const viewInvoiceDetail = async (inv: PurchaseInvoice) => {
    setSelectedInvoice(inv);
    setIsDetailOpen(true);
    try {
      if (window.posApi?.purchaseInvoices) {
        const report = await window.posApi.purchaseInvoices.matchThreeWay(inv.id);
        setMatchReport(report);
      }
    } catch (err) {
      console.error('Failed to perform 3-way match:', err);
      setMatchReport(null);
    }
  };

  const handlePostInvoice = async (invId: string) => {
    if (!window.confirm('Are you sure you want to post this supplier invoice? This will commit the payable liability.')) return;
    try {
      if (window.posApi?.purchaseInvoices) {
        await window.posApi.purchaseInvoices.postInvoice(
          { purchaseInvoiceId: invId, managerApproved: true },
          currentActor
        );
        alert('Invoice posted successfully!');
        setIsDetailOpen(false);
        loadInvoices();
      }
    } catch (err: any) {
      alert(`Posting failed: ${err.message}`);
    }
  };

  const handleVoidInvoice = async (invId: string) => {
    const reason = window.prompt('Enter reason for voiding this invoice:');
    if (!reason) return;
    try {
      if (window.posApi?.purchaseInvoices) {
        await window.posApi.purchaseInvoices.voidInvoice(invId, reason, currentActor);
        alert('Invoice voided successfully.');
        setIsDetailOpen(false);
        loadInvoices();
      }
    } catch (err: any) {
      alert(`Void failed: ${err.message}`);
    }
  };

  const handleAllocatePayment = async () => {
    if (!selectedInvoice) return;
    const amountMinor = Math.round(parseFloat(payAmount) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    try {
      if (window.posApi?.purchaseInvoices) {
        await window.posApi.purchaseInvoices.allocatePayment(
          {
            purchaseInvoiceId: selectedInvoice.id,
            amountMinor,
            paymentMethod: payMethod
          },
          currentActor
        );
        alert('Payment allocated successfully!');
        setIsPayOpen(false);
        setPayAmount('');
        setIsDetailOpen(false);
        loadInvoices();
      }
    } catch (err: any) {
      alert(`Payment failed: ${err.message}`);
    }
  };

  const getStatusBadge = (status: PurchaseInvoiceStatus) => {
    switch (status) {
      case 'posted':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"><CheckCircle className="w-3 h-3" /> Posted</span>;
      case 'paid':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Check className="w-3 h-3" /> Paid</span>;
      case 'partially_paid':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20"><Clock className="w-3 h-3" /> Partially Paid</span>;
      case 'draft':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20"><FileText className="w-3 h-3" /> Draft</span>;
      case 'pending_approval':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle className="w-3 h-3" /> Pending Approval</span>;
      case 'voided':
        return <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20"><Ban className="w-3 h-3" /> Voided</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by invoice #, supplier ref, or vendor name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800/80 text-white text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800/80 text-white text-xs px-3 py-2 rounded-xl border border-slate-700/80 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="posted">Posted</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="voided">Voided</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadInvoices}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
            title="Refresh Invoices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Invoice List Table */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800/50 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Invoice #</th>
              <th className="py-3 px-4">Supplier</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Total</th>
              <th className="py-3 px-4 text-right">Paid</th>
              <th className="py-3 px-4 text-right">Outstanding</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  {loading ? 'Loading invoices...' : 'No purchase invoices found.'}
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                  <td className="py-3 px-4 font-mono font-medium text-white">
                    {inv.invoiceNumber}
                    {inv.supplierInvoiceNumber && (
                      <span className="block text-[10px] text-slate-400 font-sans">
                        Ref: {inv.supplierInvoiceNumber}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-white">{inv.supplierName}</span>
                    {inv.supplierCode && <span className="block text-[10px] text-slate-500">{inv.supplierCode}</span>}
                  </td>
                  <td className="py-3 px-4">
                    <span>{inv.invoiceDate}</span>
                    {inv.dueDate && <span className="block text-[10px] text-slate-500">Due: {inv.dueDate}</span>}
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(inv.status)}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-white">
                    Rs {(inv.totalMinor / 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-400">
                    Rs {(inv.paidMinor / 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-amber-400 font-semibold">
                    Rs {(inv.outstandingMinor / 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => viewInvoiceDetail(inv)}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded-lg transition inline-flex items-center gap-1 text-[11px]"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice Detail & 3-Way Match Modal */}
      {isDetailOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 bg-slate-800/80 border-b border-slate-700/80 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Supplier Invoice #{selectedInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Vendor: {selectedInvoice.supplierName} | Date: {selectedInvoice.invoiceDate}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(selectedInvoice.status)}
                <button
                  onClick={() => setIsDetailOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* 3-Way Matching Summary Banner */}
              {matchReport && (
                <div className={`p-3 rounded-xl border ${
                  matchReport.overallStatus === 'exact_match'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : matchReport.overallStatus === 'acceptable_variance'
                    ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      {matchReport.overallStatus === 'exact_match' && <CheckCircle className="w-4 h-4" />}
                      {matchReport.overallStatus === 'acceptable_variance' && <Check className="w-4 h-4" />}
                      {matchReport.overallStatus === 'variance_exceeded' && <AlertTriangle className="w-4 h-4" />}
                      3-Way Matching Status: {matchReport.overallStatus.replace('_', ' ').toUpperCase()}
                    </span>
                    <span className="font-mono">
                      Price Variance: {matchReport.totalPriceVarianceMinor > 0 ? '+' : ''}
                      Rs {(matchReport.totalPriceVarianceMinor / 100).toFixed(2)}
                    </span>
                  </div>
                  {matchReport.requiresManagerApproval && (
                    <p className="text-[11px] mt-1 text-amber-300">
                      ⚠ Total price discrepancy exceeds standard threshold. Manager authorization is required to post this invoice.
                    </p>
                  )}
                </div>
              )}

              {/* Line Items Table */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2">Invoice Line Items</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800/40 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3 text-right">Invoiced Qty</th>
                        <th className="py-2.5 px-3 text-right">Unit Price</th>
                        <th className="py-2.5 px-3 text-right">Discount</th>
                        <th className="py-2.5 px-3 text-right">Tax</th>
                        <th className="py-2.5 px-3 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {(selectedInvoice.lines || []).map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 px-3 font-medium text-white">{line.productName}</td>
                          <td className="py-2 px-3 text-right font-mono">{(line.quantityScaled / 1000).toFixed(2)} {line.unitName}</td>
                          <td className="py-2 px-3 text-right font-mono">Rs {(line.unitPriceMinor / 100).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">Rs {(line.discountMinor / 100).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">Rs {(line.taxMinor / 100).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-white">Rs {(line.lineTotalMinor / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals Breakdown */}
              <div className="grid grid-cols-2 gap-4 bg-slate-800/30 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">Payment Terms & Notes</span>
                  <p className="text-slate-300 mt-0.5">{selectedInvoice.notes || 'None specified.'}</p>
                </div>
                <div className="space-y-1 text-right font-mono text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal:</span>
                    <span>Rs {(selectedInvoice.subtotalMinor / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Shipping:</span>
                    <span>Rs {(selectedInvoice.shippingMinor / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Tax:</span>
                    <span>Rs {(selectedInvoice.taxMinor / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold text-sm pt-1 border-t border-slate-700">
                    <span>Total Due:</span>
                    <span>Rs {(selectedInvoice.totalMinor / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>Paid:</span>
                    <span>Rs {(selectedInvoice.paidMinor / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-amber-400 font-semibold">
                    <span>Outstanding:</span>
                    <span>Rs {(selectedInvoice.outstandingMinor / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-3 bg-slate-800/60 border-t border-slate-800 flex justify-between items-center">
              <div>
                {selectedInvoice.status !== 'voided' && selectedInvoice.paidMinor === 0 && (
                  <button
                    onClick={() => handleVoidInvoice(selectedInvoice.id)}
                    className="px-3 py-1.5 bg-rose-900/30 hover:bg-rose-900/50 text-rose-300 text-xs rounded-xl border border-rose-800/50 transition"
                  >
                    Void Invoice
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {selectedInvoice.status === 'draft' && (
                  <button
                    onClick={() => handlePostInvoice(selectedInvoice.id)}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm transition"
                  >
                    Post & Commit Payable
                  </button>
                )}
                {(selectedInvoice.status === 'posted' || selectedInvoice.status === 'partially_paid') && selectedInvoice.outstandingMinor > 0 && (
                  <button
                    onClick={() => setIsPayOpen(true)}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-sm transition flex items-center gap-1.5"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Allocate Payment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Allocation Modal */}
      {isPayOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-4 shadow-2xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              Record Supplier Payment
            </h3>
            <p className="text-slate-400">
              Invoice #{selectedInvoice.invoiceNumber} | Outstanding: <span className="text-amber-400 font-mono font-semibold">Rs {(selectedInvoice.outstandingMinor / 100).toFixed(2)}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Payment Amount (Rs)</label>
                <input
                  type="number"
                  step="0.01"
                  max={selectedInvoice.outstandingMinor / 100}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={(selectedInvoice.outstandingMinor / 100).toFixed(2)}
                  className="w-full bg-slate-800 text-white px-3 py-2 rounded-xl border border-slate-700 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full bg-slate-800 text-white px-3 py-2 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="EASYPAISA">Easypaisa / Mobile Wallet</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsPayOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleAllocatePayment}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl"
              >
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

