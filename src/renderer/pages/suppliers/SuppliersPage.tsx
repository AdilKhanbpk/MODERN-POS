import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  RefreshCw,
  X,
  DollarSign,
  AlertCircle,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  SlidersHorizontal
} from 'lucide-react';
import { EnterpriseSupplier, OutstandingPurchaseInvoice, SupplierStatementSummary } from '../../../shared/types/supplier';

export const SuppliersPage: React.FC = () => {
  const [suppliers, setSuppliers] = useState<EnterpriseSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'WITH_BALANCE'>('ALL');

  // Modals state
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isReverseModalOpen, setIsReverseModalOpen] = useState(false);

  const [editingSupplier, setEditingSupplier] = useState<EnterpriseSupplier | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<EnterpriseSupplier | null>(null);
  const [selectedPaymentForReversal, setSelectedPaymentForReversal] = useState<{ id: string; number: string } | null>(null);

  // Profile modal active tab
  const [profileTab, setProfileTab] = useState<'STATEMENT' | 'OUTSTANDING' | 'ADJUSTMENT'>('STATEMENT');

  // Supplier Statement data
  const [statement, setStatement] = useState<SupplierStatementSummary | null>(null);
  const [statementFromDate, setStatementFromDate] = useState('');
  const [statementToDate, setStatementToDate] = useState('');
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingPurchaseInvoice[]>([]);

  // Add / Edit form fields
  const [formData, setFormData] = useState({
    supplierCode: '',
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    paymentTermsDays: '30',
    creditLimitMinor: '',
    openingBalanceMinor: '',
    notes: '',
    isActive: true
  });

  // Pay Modal fields
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('Disbursed payment to supplier');
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  // Reversal fields
  const [reversalReason, setReversalReason] = useState('');

  // Adjustment fields
  const [adjType, setAdjType] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjRef, setAdjRef] = useState('');

  // Toast / notification
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      if (window.posApi?.suppliers) {
        const list = await window.posApi.suppliers.list();
        setSuppliers(list || []);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load suppliers', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const formatCents = (minor: number) => {
    const val = Number(minor || 0) / 100;
    return `Rs. ${val.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Filtering & Search
  const filteredSuppliers = suppliers.filter(s => {
    if (activeFilter === 'ACTIVE' && !s.isActive) return false;
    if (activeFilter === 'WITH_BALANCE' && s.balance === 0) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.supplierCode.toLowerCase().includes(q) ||
      (s.phone && s.phone.toLowerCase().includes(q)) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(q))
    );
  });

  const totalOutstanding = suppliers.reduce((sum, s) => sum + (s.balance > 0 ? s.balance : 0), 0);
  const activeCount = suppliers.filter(s => s.isActive).length;
  const withBalanceCount = suppliers.filter(s => s.balance !== 0).length;

  const openCreateModal = () => {
    setEditingSupplier(null);
    setFormData({
      supplierCode: '',
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      paymentTermsDays: '30',
      creditLimitMinor: '',
      openingBalanceMinor: '',
      notes: '',
      isActive: true
    });
    setIsAddEditModalOpen(true);
  };

  const openEditModal = (s: EnterpriseSupplier) => {
    setEditingSupplier(s);
    setFormData({
      supplierCode: s.supplierCode,
      name: s.name,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxNumber: s.taxNumber || '',
      paymentTermsDays: String(s.paymentTermsDays || 0),
      creditLimitMinor: s.creditLimitMinor ? String(s.creditLimitMinor / 100) : '',
      openingBalanceMinor: String(s.openingBalanceMinor / 100),
      notes: s.notes || '',
      isActive: s.isActive
    });
    setIsAddEditModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!formData.name.trim()) {
        showToast('Supplier name is required', 'error');
        return;
      }

      if (editingSupplier) {
        await window.posApi.suppliers.update(editingSupplier.id, {
          name: formData.name,
          contactPerson: formData.contactPerson || null,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address || null,
          taxNumber: formData.taxNumber || null,
          paymentTermsDays: parseInt(formData.paymentTermsDays || '0', 10),
          creditLimitMinor: formData.creditLimitMinor ? Math.round(parseFloat(formData.creditLimitMinor) * 100) : null,
          notes: formData.notes || null,
          isActive: formData.isActive
        });
        showToast(`Supplier '${formData.name}' updated successfully.`);
      } else {
        await window.posApi.suppliers.save({
          supplierCode: formData.supplierCode || undefined,
          name: formData.name,
          contactPerson: formData.contactPerson || null,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address || null,
          taxNumber: formData.taxNumber || null,
          paymentTermsDays: parseInt(formData.paymentTermsDays || '0', 10),
          creditLimitMinor: formData.creditLimitMinor ? Math.round(parseFloat(formData.creditLimitMinor) * 100) : null,
          openingBalanceMinor: formData.openingBalanceMinor ? Math.round(parseFloat(formData.openingBalanceMinor) * 100) : 0,
          notes: formData.notes || null,
          isActive: formData.isActive
        });
        showToast(`Supplier '${formData.name}' registered successfully.`);
      }

      setIsAddEditModalOpen(false);
      loadSuppliers();
    } catch (err: any) {
      showToast(err.message || 'Error saving supplier', 'error');
    }
  };

  const openProfileModal = async (s: EnterpriseSupplier) => {
    setSelectedSupplier(s);
    setProfileTab('STATEMENT');
    setIsProfileModalOpen(true);
    await loadStatement(s.id);
    await loadOutstanding(s.id);
  };

  const loadStatement = async (supplierId: string | number) => {
    try {
      const res = await window.posApi.suppliers.getStatement({
        supplierId,
        fromDate: statementFromDate || undefined,
        toDate: statementToDate || undefined
      });
      setStatement(res);
    } catch (err: any) {
      console.error('Error fetching statement:', err);
    }
  };

  const loadOutstanding = async (supplierId: string | number) => {
    try {
      const list = await window.posApi.suppliers.getOutstandingInvoices(supplierId);
      setOutstandingInvoices(list || []);
    } catch (err: any) {
      console.error('Error fetching outstanding invoices:', err);
    }
  };

  const handleReconcile = async (s: EnterpriseSupplier) => {
    try {
      const res = await window.posApi.suppliers.reconcile(s.id);
      if (res.isReconciled) {
        showToast(`Ledger is in 100% balance (Balance: ${formatCents(res.ledgerBalance)}).`);
      } else {
        showToast(`Discrepancy of ${formatCents(res.discrepancy)} resolved and synchronized.`);
      }
      loadSuppliers();
      if (selectedSupplier?.id === s.id) {
        const updated = await window.posApi.suppliers.getById(s.id);
        setSelectedSupplier(updated);
        loadStatement(s.id);
      }
    } catch (err: any) {
      showToast(err.message || 'Error reconciling balance', 'error');
    }
  };

  const openPaymentModal = async (s: EnterpriseSupplier) => {
    setSelectedSupplier(s);
    setPayAmount((Math.max(0, s.balance) / 100).toFixed(2));
    setPayMethod('CASH');
    setPayReference('');
    setPayNotes(`Payment disbursed to ${s.name}`);
    setAllocations({});

    const out = await window.posApi.suppliers.getOutstandingInvoices(s.id);
    setOutstandingInvoices(out || []);

    let remainingToAllocate = Math.max(0, s.balance);
    const initialAlloc: Record<string, string> = {};
    for (const inv of out || []) {
      if (remainingToAllocate <= 0) break;
      const alloc = Math.min(remainingToAllocate, inv.remainingDueMinor);
      initialAlloc[String(inv.purchaseId)] = (alloc / 100).toFixed(2);
      remainingToAllocate -= alloc;
    }
    setAllocations(initialAlloc);

    setIsPayModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;

    try {
      const amountMinor = Math.round(parseFloat(payAmount) * 100);
      if (isNaN(amountMinor) || amountMinor <= 0) {
        showToast('Payment amount must be greater than zero', 'error');
        return;
      }

      const allocArray: Array<{ purchaseDocumentId: string | number; allocatedMinor: number }> = [];
      let totalAlloc = 0;

      for (const [docId, valStr] of Object.entries(allocations)) {
        const valMinor = Math.round(parseFloat(valStr || '0') * 100);
        if (valMinor > 0) {
          allocArray.push({
            purchaseDocumentId: docId,
            allocatedMinor: valMinor
          });
          totalAlloc += valMinor;
        }
      }

      if (totalAlloc > amountMinor) {
        showToast(`Allocated sum (${formatCents(totalAlloc)}) exceeds payment amount (${formatCents(amountMinor)})`, 'error');
        return;
      }

      await window.posApi.suppliers.recordPayment({
        supplierId: selectedSupplier.id,
        amountMinor,
        paymentMethod: payMethod,
        referenceNumber: payReference || undefined,
        notes: payNotes,
        allocations: allocArray
      });

      showToast(`Payment of ${formatCents(amountMinor)} recorded successfully.`);
      setIsPayModalOpen(false);
      loadSuppliers();

      if (isProfileModalOpen && selectedSupplier) {
        const updated = await window.posApi.suppliers.getById(selectedSupplier.id);
        setSelectedSupplier(updated);
        loadStatement(selectedSupplier.id);
        loadOutstanding(selectedSupplier.id);
      }
    } catch (err: any) {
      showToast(err.message || 'Error recording payment', 'error');
    }
  };

  const openReversalModal = (paymentId: string, paymentNumber: string) => {
    setSelectedPaymentForReversal({ id: paymentId, number: paymentNumber });
    setReversalReason('');
    setIsReverseModalOpen(true);
  };

  const handleConfirmReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPaymentForReversal) return;

    try {
      if (!reversalReason.trim()) {
        showToast('Reversal reason is required', 'error');
        return;
      }

      await window.posApi.suppliers.reversePayment({
        paymentId: selectedPaymentForReversal.id,
        reason: reversalReason.trim()
      });

      showToast(`Payment #${selectedPaymentForReversal.number} has been reversed.`);
      setIsReverseModalOpen(false);
      loadSuppliers();

      if (selectedSupplier) {
        const updated = await window.posApi.suppliers.getById(selectedSupplier.id);
        setSelectedSupplier(updated);
        loadStatement(selectedSupplier.id);
        loadOutstanding(selectedSupplier.id);
      }
    } catch (err: any) {
      showToast(err.message || 'Error reversing payment', 'error');
    }
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;

    try {
      const amountMinor = Math.round(parseFloat(adjAmount) * 100);
      if (isNaN(amountMinor) || amountMinor <= 0) {
        showToast('Adjustment amount must be greater than zero', 'error');
        return;
      }
      if (!adjReason.trim()) {
        showToast('Adjustment reason is mandatory for audit trail', 'error');
        return;
      }

      await window.posApi.suppliers.recordAdjustment({
        supplierId: selectedSupplier.id,
        adjustmentType: adjType,
        amountMinor,
        reason: adjReason.trim(),
        referenceNumber: adjRef || undefined
      });

      showToast(`Adjustment of ${formatCents(amountMinor)} recorded.`);
      setAdjAmount('');
      setAdjReason('');
      setAdjRef('');
      loadSuppliers();

      const updated = await window.posApi.suppliers.getById(selectedSupplier.id);
      setSelectedSupplier(updated);
      loadStatement(selectedSupplier.id);
    } catch (err: any) {
      showToast(err.message || 'Error recording adjustment', 'error');
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-xl text-sm transition-all ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
          }`}
        >
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <Building2 className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold tracking-tight text-white">Suppliers & Accounts Payable</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Track vendor purchases, disbursements, credit terms, partial payment allocations and ledger reconciliation
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadSuppliers}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 transition"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Supplier</span>
          </button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-5">
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Suppliers</div>
          <div className="text-2xl font-bold text-white mt-1">{suppliers.length}</div>
          <div className="text-xs text-slate-500 mt-1">{activeCount} active in directory</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Accounts Payable</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{formatCents(totalOutstanding)}</div>
          <div className="text-xs text-amber-500/80 mt-1">Total liability owed across suppliers</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Vendors with Balance</div>
          <div className="text-2xl font-bold text-indigo-300 mt-1">{withBalanceCount}</div>
          <div className="text-xs text-slate-500 mt-1">Pending payments or advance credits</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Ledger Health</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">100% In Sync</div>
          <div className="text-xs text-emerald-500/80 mt-1">Double-entry verified & immutable</div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search suppliers by name, code, phone, or contact person..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900/70 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-900 p-1 border border-slate-800 rounded-xl text-xs">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            All ({suppliers.length})
          </button>
          <button
            onClick={() => setActiveFilter('ACTIVE')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeFilter === 'ACTIVE' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setActiveFilter('WITH_BALANCE')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              activeFilter === 'WITH_BALANCE' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            With Balance ({withBalanceCount})
          </button>
        </div>
      </div>

      {/* Suppliers Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 sticky top-0 backdrop-blur z-10">
            <tr>
              <th className="py-3 px-4">Supplier</th>
              <th className="py-3 px-4">Contact</th>
              <th className="py-3 px-4">Terms</th>
              <th className="py-3 px-4 text-right">Payable Balance</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                  Loading supplier directory...
                </td>
              </tr>
            ) : filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-500">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-400" />
                  No suppliers found matching the criteria.
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-900/60 transition group">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white group-hover:text-indigo-300 transition">
                      {s.name}
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      {s.supplierCode}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="text-xs text-slate-300">{s.contactPerson || '—'}</div>
                    <div className="text-xs text-slate-400 font-mono">{s.phone || '—'}</div>
                  </td>

                  <td className="py-3 px-4">
                    <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                      {s.paymentTermsDays ? `${s.paymentTermsDays} days net` : 'Immediate cash'}
                    </span>
                    {s.creditLimitMinor && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Limit: {formatCents(s.creditLimitMinor)}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right font-mono font-bold">
                    <span
                      className={
                        s.balance > 0
                          ? 'text-amber-400'
                          : s.balance < 0
                          ? 'text-emerald-400'
                          : 'text-slate-400'
                      }
                    >
                      {formatCents(s.balance)}
                    </span>
                    {s.balance < 0 && (
                      <div className="text-[10px] text-emerald-500 font-normal">Advance credit</div>
                    )}
                  </td>

                  <td className="py-3 px-4 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.isActive
                          ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40'
                          : 'bg-rose-950/50 text-rose-400 border border-rose-800/40'
                      }`}
                    >
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openPaymentModal(s)}
                        disabled={!s.isActive}
                        className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-600/40 rounded-lg text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Disburse Payment"
                      >
                        Disburse Pay
                      </button>
                      <button
                        onClick={() => openProfileModal(s)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                      >
                        Statement
                      </button>
                      <button
                        onClick={() => openEditModal(s)}
                        className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                        title="Edit Supplier"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 1. ADD / EDIT SUPPLIER MODAL */}
      {isAddEditModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white">
                {editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : 'Create New Supplier'}
              </h2>
              <button
                onClick={() => setIsAddEditModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Supplier Code</label>
                  <input
                    type="text"
                    value={formData.supplierCode}
                    onChange={(e) => setFormData({ ...formData, supplierCode: e.target.value })}
                    placeholder="Auto-generated if empty"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-medium">Supplier / Vendor Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Nestlé Pakistan Ltd."
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Contact Person</label>
                  <input
                    type="text"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    placeholder="e.g. Muhammad Asif"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-medium">Phone Number</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g. 0300-1234567"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Email Address</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="vendor@company.com"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-medium">Tax / NTN / STRN</label>
                  <input
                    type="text"
                    value={formData.taxNumber}
                    onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                    placeholder="NTN-1234567-8"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Payment Terms (Days)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.paymentTermsDays}
                    onChange={(e) => setFormData({ ...formData, paymentTermsDays: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-medium">Credit Limit (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.creditLimitMinor}
                    onChange={(e) => setFormData({ ...formData, creditLimitMinor: e.target.value })}
                    placeholder="Optional"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                {!editingSupplier && (
                  <div>
                    <label className="text-xs text-slate-400 font-medium">Opening Balance (Rs.)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.openingBalanceMinor}
                      onChange={(e) => setFormData({ ...formData, openingBalanceMinor: e.target.value })}
                      placeholder="+ We owe, - Advance"
                      className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Address</label>
                <textarea
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Factory / Warehouse street address..."
                  className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="isActive" className="text-xs text-slate-300">
                  Supplier is active and authorized for purchases and disbursements
                </label>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition"
                >
                  {editingSupplier ? 'Update Supplier' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. SUPPLIER PROFILE & STATEMENT MODAL */}
      {isProfileModalOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white">{selectedSupplier.name}</h2>
                  <span className="text-xs font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300">
                    {selectedSupplier.supplierCode}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      selectedSupplier.isActive
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                        : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
                    }`}
                  >
                    {selectedSupplier.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center gap-4">
                  <span>Phone: {selectedSupplier.phone || 'N/A'}</span>
                  <span>Contact: {selectedSupplier.contactPerson || 'N/A'}</span>
                  <span>Terms: {selectedSupplier.paymentTermsDays} days</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-right mr-3">
                  <div className="text-xs uppercase text-slate-400 font-medium">Authoritative Balance</div>
                  <div
                    className={`text-xl font-bold font-mono ${
                      selectedSupplier.balance > 0
                        ? 'text-amber-400'
                        : selectedSupplier.balance < 0
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {formatCents(selectedSupplier.balance)}
                  </div>
                </div>
                <button
                  onClick={() => handleReconcile(selectedSupplier)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center gap-1 transition"
                  title="Verify & Reconcile Ledger"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconcile</span>
                </button>
                <button
                  onClick={() => setIsProfileModalOpen(false)}
                  className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex border-b border-slate-800 px-5 bg-slate-900/50 text-xs font-semibold">
              <button
                onClick={() => setProfileTab('STATEMENT')}
                className={`py-3 px-4 border-b-2 transition ${
                  profileTab === 'STATEMENT'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Account Statement
              </button>
              <button
                onClick={() => setProfileTab('OUTSTANDING')}
                className={`py-3 px-4 border-b-2 transition ${
                  profileTab === 'OUTSTANDING'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Outstanding Bills ({outstandingInvoices.length})
              </button>
              <button
                onClick={() => {
                  setAdjType('DEBIT');
                  setAdjAmount('');
                  setAdjReason('');
                  setProfileTab('ADJUSTMENT');
                }}
                className={`py-3 px-4 border-b-2 transition ${
                  profileTab === 'ADJUSTMENT'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Authorized Adjustment
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {profileTab === 'STATEMENT' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">From:</span>
                        <input
                          type="date"
                          value={statementFromDate}
                          onChange={(e) => setStatementFromDate(e.target.value)}
                          className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">To:</span>
                        <input
                          type="date"
                          value={statementToDate}
                          onChange={(e) => setStatementToDate(e.target.value)}
                          className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white"
                        />
                      </div>
                      <button
                        onClick={() => loadStatement(selectedSupplier.id)}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium"
                      >
                        Apply
                      </button>
                    </div>

                    <button
                      onClick={() => openPaymentModal(selectedSupplier)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold flex items-center gap-1"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Disburse Payment</span>
                    </button>
                  </div>

                  {statement && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-slate-400 block">Opening Balance</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatCents(statement.openingBalanceMinor)}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-slate-400 block">Purchases (+)</span>
                        <span className="font-mono font-bold text-amber-400">
                          +{formatCents(statement.totalPurchasesMinor)}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-slate-400 block">Payments (-)</span>
                        <span className="font-mono font-bold text-emerald-400">
                          -{formatCents(statement.totalPaymentsMinor)}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-slate-400 block">Returns (-)</span>
                        <span className="font-mono font-bold text-indigo-300">
                          -{formatCents(statement.totalReturnsMinor)}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-slate-400 block">Closing Balance</span>
                        <span className="font-mono font-bold text-white">
                          {formatCents(statement.closingBalanceMinor)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3 text-right">Debit (-)</th>
                          <th className="py-2.5 px-3 text-right">Credit (+)</th>
                          <th className="py-2.5 px-3 text-right">Running Balance</th>
                          <th className="py-2.5 px-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 font-mono">
                        {!statement || statement.entries.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-slate-500 font-sans">
                              No statement entries recorded for this date range.
                            </td>
                          </tr>
                        ) : (
                          statement.entries.map((entry) => (
                            <tr key={entry.id} className="hover:bg-slate-900/40">
                              <td className="py-2 px-3 text-slate-400">
                                {new Date(entry.entryDate).toLocaleDateString()}
                              </td>
                              <td className="py-2 px-3 font-sans">
                                <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-300">
                                  {entry.entryType}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-300 font-sans">
                                {entry.description}
                              </td>
                              <td className="py-2 px-3 text-right text-emerald-400">
                                {entry.debitMinor > 0 ? formatCents(entry.debitMinor) : '—'}
                              </td>
                              <td className="py-2 px-3 text-right text-amber-400">
                                {entry.creditMinor > 0 ? formatCents(entry.creditMinor) : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-white">
                                {formatCents(entry.runningBalanceMinor)}
                              </td>
                              <td className="py-2 px-3 text-center font-sans">
                                {entry.entryType === 'PAYMENT_DISBURSED' && entry.referenceId && (
                                  <button
                                    onClick={() => openReversalModal(entry.referenceId!, entry.id.slice(0, 8))}
                                    className="text-[10px] text-rose-400 hover:text-rose-300 underline"
                                  >
                                    Reverse
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {profileTab === 'OUTSTANDING' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">
                      Unpaid and partially paid purchase bills that make up current Accounts Payable
                    </span>
                    <button
                      onClick={() => openPaymentModal(selectedSupplier)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center gap-1"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Allocate Payment</span>
                    </button>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Bill / Purchase #</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Due Date</th>
                          <th className="py-2.5 px-3 text-right">Grand Total</th>
                          <th className="py-2.5 px-3 text-right">Allocated</th>
                          <th className="py-2.5 px-3 text-right">Remaining Due</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 font-mono">
                        {outstandingInvoices.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-slate-500 font-sans">
                              No outstanding purchase bills. Supplier account is fully settled!
                            </td>
                          </tr>
                        ) : (
                          outstandingInvoices.map((inv) => (
                            <tr key={inv.purchaseId} className="hover:bg-slate-900/40">
                              <td className="py-2 px-3 font-semibold text-white">
                                {inv.invoiceNumber}
                              </td>
                              <td className="py-2 px-3 text-slate-400">
                                {new Date(inv.purchaseDate).toLocaleDateString()}
                              </td>
                              <td className="py-2 px-3 text-slate-400">
                                {new Date(inv.dueDate).toLocaleDateString()}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-200">
                                {formatCents(inv.totalMinor)}
                              </td>
                              <td className="py-2 px-3 text-right text-emerald-400">
                                {formatCents(inv.allocatedMinor)}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-amber-400">
                                {formatCents(inv.remainingDueMinor)}
                              </td>
                              <td className="py-2 px-3 text-center font-sans">
                                {inv.isOverdue ? (
                                  <span className="text-[10px] bg-rose-950/70 border border-rose-800/40 text-rose-300 px-2 py-0.5 rounded-full">
                                    Overdue ({inv.overdueDays}d)
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-emerald-950/70 border border-emerald-800/40 text-emerald-300 px-2 py-0.5 rounded-full">
                                    Current
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {profileTab === 'ADJUSTMENT' && (
                <div className="max-w-xl mx-auto space-y-4">
                  <div className="bg-amber-950/30 border border-amber-500/30 p-3.5 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-300">Audited Balance Correction</div>
                      <div className="mt-0.5 text-amber-200/80">
                        Manual balance overwrite is strictly prohibited. Every change must be recorded via an
                        immutable Debit or Credit adjustment document with an explicit reason.
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleRecordAdjustment} className="space-y-3.5 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-400 font-medium">Adjustment Type *</label>
                        <select
                          value={adjType}
                          onChange={(e) => setAdjType(e.target.value as any)}
                          className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="DEBIT">Debit Adjustment (Decreases Payable)</option>
                          <option value="CREDIT">Credit Adjustment (Increases Payable)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-slate-400 font-medium">Amount (Rs.) *</label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value)}
                          placeholder="e.g. 500.00"
                          className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-slate-400 font-medium">Reference / Note # (Optional)</label>
                      <input
                        type="text"
                        value={adjRef}
                        onChange={(e) => setAdjRef(e.target.value)}
                        placeholder="e.g. Audit Voucher #ADJ-102"
                        className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-400 font-medium">Audit Reason *</label>
                      <textarea
                        rows={3}
                        required
                        value={adjReason}
                        onChange={(e) => setAdjReason(e.target.value)}
                        placeholder="State reason for adjusting supplier balance..."
                        className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-600/20"
                      >
                        Post Adjustment Entry
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. DISBURSE PAYMENT MODAL WITH ALLOCATION */}
      {isPayModalOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white">Disburse Payment to Supplier</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedSupplier.name} ({selectedSupplier.supplierCode}) · Payable Balance:{' '}
                  <span className="font-mono font-bold text-amber-400">
                    {formatCents(selectedSupplier.balance)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setIsPayModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 font-medium">Disbursed Amount (Rs.) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="text-slate-400 font-medium">Payment Method *</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="CASH">Cash Drawer</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="ONLINE">Online / Easypaisa</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 font-medium">Reference / Cheque #</label>
                  <input
                    type="text"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="e.g. CHQ-991203"
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 font-medium">Notes / Memo</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {outstandingInvoices.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">
                      Allocate Payment Across Outstanding Bills (Optional):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        let remaining = Math.round(parseFloat(payAmount || '0') * 100);
                        const autoAlloc: Record<string, string> = {};
                        for (const inv of outstandingInvoices) {
                          if (remaining <= 0) break;
                          const alloc = Math.min(remaining, inv.remainingDueMinor);
                          autoAlloc[String(inv.purchaseId)] = (alloc / 100).toFixed(2);
                          remaining -= alloc;
                        }
                        setAllocations(autoAlloc);
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                    >
                      Auto-Allocate (FIFO)
                    </button>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <table className="w-full text-left">
                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Bill #</th>
                          <th className="py-2 px-3 text-right">Remaining Due</th>
                          <th className="py-2 px-3 text-right">Allocate (Rs.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 font-mono">
                        {outstandingInvoices.map((inv) => (
                          <tr key={inv.purchaseId}>
                            <td className="py-2 px-3 font-semibold text-slate-200">
                              {inv.invoiceNumber}
                            </td>
                            <td className="py-2 px-3 text-right text-amber-400">
                              {formatCents(inv.remainingDueMinor)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={(inv.remainingDueMinor / 100).toFixed(2)}
                                value={allocations[String(inv.purchaseId)] || ''}
                                onChange={(e) =>
                                  setAllocations({
                                    ...allocations,
                                    [String(inv.purchaseId)]: e.target.value
                                  })
                                }
                                placeholder="0.00"
                                className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-right text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPayModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-amber-600/20 transition"
                >
                  Disburse & Post Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. PAYMENT REVERSAL CONFIRMATION MODAL */}
      {isReverseModalOpen && selectedPaymentForReversal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <RotateCcw className="w-6 h-6" />
              <h2 className="text-lg font-bold text-white">Reverse Payment Disbursement</h2>
            </div>

            <p className="text-xs text-slate-300 mt-2">
              Reversing payment <span className="font-mono text-white font-bold">#{selectedPaymentForReversal.number}</span> will
              restore the supplier's payable liability and cancel all related invoice allocations.
            </p>

            <form onSubmit={handleConfirmReversal} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-slate-400 font-medium">Reversal Audit Reason *</label>
                <textarea
                  rows={3}
                  required
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="e.g. Cheque bounced / Duplicate payment entry..."
                  className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReverseModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold shadow-lg shadow-rose-600/20 transition"
                >
                  Confirm Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
