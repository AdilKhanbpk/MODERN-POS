import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  RefreshCw,
  X,
  CreditCard,
  History,
  DollarSign,
  Search,
  AlertTriangle,
  FileText,
  Clock,
  CheckCircle2,
  Filter
} from 'lucide-react';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'statement' | 'invoices'>('statement');

  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [statementData, setStatementData] = useState<any | null>(null);
  const [outstandingInvoices, setOutstandingInvoices] = useState<any[]>([]);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formTaxNumber, setFormTaxNumber] = useState('');
  const [formType, setFormType] = useState('retail');
  const [formCreditLimit, setFormCreditLimit] = useState('0');
  const [formCreditDays, setFormCreditDays] = useState('30');
  const [formOpeningBalance, setFormOpeningBalance] = useState('0');
  const [formNotes, setFormNotes] = useState('');

  // Payment form
  const [paymentAmountDecimal, setPaymentAmountDecimal] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('Payment towards dues');
  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, string>>({});

  const loadCustomers = async () => {
    try {
      setLoading(true);
      if (window.posApi?.customers) {
        const list = await window.posApi.customers.list({
          query: searchQuery,
          customerType: typeFilter || undefined,
          overdueOnly: overdueOnly || undefined
        });
        setCustomers(list || []);
      }
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [searchQuery, typeFilter, overdueOnly]);

  const handleOpenAdd = () => {
    setFormName('');
    setFormCode('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormTaxNumber('');
    setFormType('retail');
    setFormCreditLimit('10000');
    setFormCreditDays('30');
    setFormOpeningBalance('0');
    setFormNotes('');
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (c: any) => {
    setSelectedCustomer(c);
    setFormName(c.name);
    setFormCode(c.customerCode);
    setFormPhone(c.phone || '');
    setFormEmail(c.email || '');
    setFormAddress(c.address || '');
    setFormTaxNumber(c.taxNumber || '');
    setFormType(c.customerType || 'retail');
    setFormCreditLimit(((c.creditLimitMinor || 0) / 100).toString());
    setFormCreditDays((c.creditDays || 0).toString());
    setFormOpeningBalance(((c.openingBalanceMinor || 0) / 100).toString());
    setFormNotes(c.notes || '');
    setIsEditModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formName.trim(),
        customerCode: formCode.trim() || undefined,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
        address: formAddress.trim() || null,
        taxNumber: formTaxNumber.trim() || null,
        customerType: formType,
        creditLimitMinor: Math.round(parseFloat(formCreditLimit || '0') * 100),
        creditDays: parseInt(formCreditDays || '0', 10),
        openingBalanceMinor: Math.round(parseFloat(formOpeningBalance || '0') * 100),
        notes: formNotes.trim() || null
      };

      if (isEditModalOpen && selectedCustomer) {
        await window.posApi.customers.update(selectedCustomer.id, payload);
      } else {
        await window.posApi.customers.save(payload);
      }

      setIsAddModalOpen(false);
      setIsEditModalOpen(false);
      loadCustomers();
    } catch (err: any) {
      alert(`Error saving customer: ${err.message}`);
    }
  };

  const openCustomerDetails = async (c: any, tab: 'statement' | 'invoices' = 'statement') => {
    setSelectedCustomer(c);
    setDetailTab(tab);
    try {
      const [statement, invoices] = await Promise.all([
        window.posApi.customers.getStatement(c.id),
        window.posApi.customers.getOutstandingInvoices(c.id)
      ]);
      setStatementData(statement);
      setOutstandingInvoices(invoices || []);
      setIsDetailModalOpen(true);
    } catch (err: any) {
      alert(`Error fetching customer details: ${err.message}`);
    }
  };

  const openPaymentModal = async (c: any) => {
    setSelectedCustomer(c);
    const balance = c.calculatedBalanceMinor ?? c.balanceMinor ?? c.balance ?? 0;
    setPaymentAmountDecimal((Math.max(0, balance) / 100).toFixed(2));
    setPaymentNotes('Cash payment towards dues');

    try {
      const invoices = await window.posApi.customers.getOutstandingInvoices(c.id);
      setOutstandingInvoices(invoices || []);

      // Pre-fill allocations to outstanding invoices
      let remainingToAllocate = Math.max(0, balance);
      const allocMap: Record<string, string> = {};

      for (const inv of invoices || []) {
        if (remainingToAllocate <= 0) break;
        const alloc = Math.min(remainingToAllocate, inv.outstandingMinor);
        allocMap[inv.salesDocumentId] = (alloc / 100).toFixed(2);
        remainingToAllocate -= alloc;
      }

      setPaymentAllocations(allocMap);
      setIsPayModalOpen(true);
    } catch (err: any) {
      alert(`Error loading invoices: ${err.message}`);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      const totalAmountMinor = Math.round(parseFloat(paymentAmountDecimal || '0') * 100);
      if (totalAmountMinor <= 0) {
        alert('Please enter a valid payment amount greater than zero.');
        return;
      }

      const allocations = Object.entries(paymentAllocations)
        .map(([docId, amtStr]) => ({
          salesDocumentId: docId,
          amountMinor: Math.round(parseFloat(amtStr || '0') * 100)
        }))
        .filter(a => a.amountMinor > 0);

      const allocatedTotal = allocations.reduce((sum, a) => sum + a.amountMinor, 0);
      if (allocatedTotal > totalAmountMinor) {
        alert(`Allocated amount (Rs. ${(allocatedTotal / 100).toFixed(2)}) cannot exceed total payment (Rs. ${(totalAmountMinor / 100).toFixed(2)}).`);
        return;
      }

      await window.posApi.customers.recordPayment({
        customerId: selectedCustomer.id,
        amountMinor: totalAmountMinor,
        notes: paymentNotes,
        allocations
      });

      setIsPayModalOpen(false);
      loadCustomers();
    } catch (err: any) {
      alert(`Error recording payment: ${err.message}`);
    }
  };

  const formatCents = (cents: number | undefined | null) => `Rs. ${((cents || 0) / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Customer Accounts & Credit Limits</h1>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage customer accounts, credit exposure, receivable ledgers, and payment allocations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-lg transition"
          >
            <Plus className="w-4 h-4" /> Add Customer
          </button>
          <button
            onClick={loadCustomers}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3 my-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, customer code, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
        >
          <option value="">All Customer Types</option>
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
          <option value="business">Business</option>
          <option value="other">Other</option>
        </select>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="rounded border-slate-700 text-blue-600 focus:ring-0"
          />
          <span className="flex items-center gap-1 text-amber-400">
            <Clock className="w-3.5 h-3.5" /> Overdue Dues Only
          </span>
        </label>
      </div>

      {/* Customer List Table */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0 z-10">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Customer Name</th>
              <th className="p-3">Type</th>
              <th className="p-3">Phone</th>
              <th className="p-3 text-right">Credit Limit</th>
              <th className="p-3 text-center">Credit Days</th>
              <th className="p-3 text-right">Outstanding Balance</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {customers.map((c) => {
              const balance = c.calculatedBalanceMinor ?? c.balanceMinor ?? c.balance ?? 0;
              const limit = c.creditLimitMinor ?? c.creditLimit ?? 0;
              const owesMoney = balance > 0;
              const isOverLimit = limit > 0 && balance > limit;

              return (
                <tr key={c.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-mono text-slate-400">{c.customerCode}</td>
                  <td className="p-3">
                    <div className="font-semibold text-white">{c.name}</div>
                    {c.taxNumber && <span className="text-[10px] text-slate-500">NTN: {c.taxNumber}</span>}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold ${
                      c.customerType === 'wholesale' ? 'bg-purple-900/40 text-purple-300 border border-purple-700/50' :
                      c.customerType === 'business' ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {c.customerType || 'retail'}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-300">{c.phone || '-'}</td>
                  <td className="p-3 text-right font-mono text-slate-400">
                    {limit > 0 ? formatCents(limit) : <span className="text-slate-600">No Limit</span>}
                  </td>
                  <td className="p-3 text-center font-mono text-slate-400">
                    {c.creditDays ? `${c.creditDays}d` : '-'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold">
                    <div className="flex flex-col items-end">
                      <span className={owesMoney ? (isOverLimit ? 'text-red-400' : 'text-amber-400') : 'text-emerald-400'}>
                        {formatCents(balance)}
                      </span>
                      {isOverLimit && (
                        <span className="text-[9px] text-red-400 flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" /> Over Limit
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {owesMoney && (
                        <button
                          onClick={() => openPaymentModal(c)}
                          className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                          title="Record Payment"
                        >
                          <DollarSign className="w-3.5 h-3.5" /> Settle
                        </button>
                      )}
                      <button
                        onClick={() => openCustomerDetails(c, 'statement')}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                        title="View Statement & Invoices"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleOpenEdit(c)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition text-xs"
                        title="Edit Customer"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {customers.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No customers found matching the search criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Customer Modal */}
      {(isAddModalOpen || isEditModalOpen) && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">
                {isEditModalOpen ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button
                onClick={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Customer Full Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    placeholder="e.g. Tariq Mehmood"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Customer Code</label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono uppercase"
                    placeholder="Auto-generated if empty"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                    placeholder="03001234567"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Email Address</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    placeholder="customer@domain.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Customer Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="business">Business / Corporate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tax / NTN Number</label>
                  <input
                    type="text"
                    value={formTaxNumber}
                    onChange={(e) => setFormTaxNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                    placeholder="1234567-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Credit Limit (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formCreditLimit}
                    onChange={(e) => setFormCreditLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Credit Days</label>
                  <input
                    type="number"
                    value={formCreditDays}
                    onChange={(e) => setFormCreditDays(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Opening Dues (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={isEditModalOpen}
                    value={formOpeningBalance}
                    onChange={(e) => setFormOpeningBalance(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Physical Address</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="Street address, city"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="Special instructions or credit approval notes..."
                />
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                {isEditModalOpen ? 'Save Changes' : 'Create Customer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Customer Statement and Invoices Modal */}
      {isDetailModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-2xl p-6 shadow-2xl flex flex-col max-h-[88vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">{selectedCustomer.name}</h3>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {selectedCustomer.customerCode}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Limit: {formatCents(selectedCustomer.creditLimitMinor)} • Credit Days: {selectedCustomer.creditDays || 0}d • Balance: <span className="font-bold text-amber-400">{formatCents(statementData?.closingBalanceMinor)}</span>
                </p>
              </div>
              <button onClick={() => setIsDetailModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab selection */}
            <div className="flex gap-2 my-3 border-b border-slate-800 pb-2">
              <button
                onClick={() => setDetailTab('statement')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  detailTab === 'statement' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Account Statement
              </button>
              <button
                onClick={() => setDetailTab('invoices')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                  detailTab === 'invoices' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Outstanding Invoices ({outstandingInvoices.length})
              </button>
            </div>

            {/* Statement View */}
            {detailTab === 'statement' && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5">Type</th>
                      <th className="p-2.5">Description</th>
                      <th className="p-2.5 text-right">Debit (+)</th>
                      <th className="p-2.5 text-right">Credit (-)</th>
                      <th className="p-2.5 text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {statementData?.entries?.map((e: any) => (
                      <tr key={e.id} className="hover:bg-slate-800/30">
                        <td className="p-2.5 font-mono text-[11px] text-slate-400">
                          {e.entryDate ? new Date(e.entryDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="p-2.5 font-semibold text-slate-300">{e.entryType}</td>
                        <td className="p-2.5 text-slate-400">{e.description || '-'}</td>
                        <td className="p-2.5 text-right font-mono text-amber-400">
                          {e.debitMinor > 0 ? formatCents(e.debitMinor) : '-'}
                        </td>
                        <td className="p-2.5 text-right font-mono text-emerald-400">
                          {e.creditMinor > 0 ? formatCents(e.creditMinor) : '-'}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-white">
                          {formatCents(e.runningBalanceMinor)}
                        </td>
                      </tr>
                    ))}
                    {(!statementData?.entries || statementData.entries.length === 0) && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-500">
                          No ledger transactions recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Invoices View */}
            {detailTab === 'invoices' && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0">
                    <tr>
                      <th className="p-2.5">Invoice #</th>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5 text-right">Total</th>
                      <th className="p-2.5 text-right">Paid</th>
                      <th className="p-2.5 text-right">Remaining Due</th>
                      <th className="p-2.5 text-center">Due Date</th>
                      <th className="p-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {outstandingInvoices.map((inv) => (
                      <tr key={inv.salesDocumentId} className="hover:bg-slate-800/30">
                        <td className="p-2.5 font-mono font-bold text-white">{inv.saleNumber}</td>
                        <td className="p-2.5 font-mono text-[11px] text-slate-400">
                          {new Date(inv.saleDate).toLocaleDateString()}
                        </td>
                        <td className="p-2.5 text-right font-mono text-slate-300">{formatCents(inv.totalMinor)}</td>
                        <td className="p-2.5 text-right font-mono text-emerald-400">{formatCents(inv.paidMinor)}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-amber-400">
                          {formatCents(inv.outstandingMinor)}
                        </td>
                        <td className="p-2.5 text-center font-mono text-slate-400">{inv.dueDate}</td>
                        <td className="p-2.5 text-center">
                          {inv.isOverdue ? (
                            <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-700/50 text-[10px] font-semibold">
                              {inv.overdueDays}d Overdue
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 text-[10px] font-semibold">
                              Current
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {outstandingInvoices.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500">
                          No outstanding invoices. Account is fully paid!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settle Customer Dues Modal with Allocations */}
      {isPayModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Receive Customer Payment</h3>
                <p className="text-xs text-slate-400">
                  {selectedCustomer.name} (Total Dues: {formatCents(selectedCustomer.calculatedBalanceMinor ?? selectedCustomer.balanceMinor)})
                </p>
              </div>
              <button onClick={() => setIsPayModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Total Payment Received (Rs.) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmountDecimal}
                  onChange={(e) => setPaymentAmountDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-lg font-bold font-mono text-emerald-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Receipt Note / Description</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              {/* Outstanding Invoices Allocation checklist */}
              {outstandingInvoices.length > 0 && (
                <div className="border border-slate-800 rounded-xl p-3 bg-slate-950">
                  <div className="font-semibold text-slate-300 mb-2">Invoice Payment Allocation:</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {outstandingInvoices.map((inv) => (
                      <div key={inv.salesDocumentId} className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                        <div>
                          <div className="font-bold text-white">{inv.saleNumber}</div>
                          <div className="text-[10px] text-slate-400">
                            Due: {formatCents(inv.outstandingMinor)}
                            {inv.isOverdue && <span className="text-red-400 ml-1.5 font-semibold">({inv.overdueDays}d overdue)</span>}
                          </div>
                        </div>

                        <div className="w-28">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={paymentAllocations[inv.salesDocumentId] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPaymentAllocations({
                                ...paymentAllocations,
                                [inv.salesDocumentId]: val
                              });
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-right font-mono text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg"
              >
                Record Payment & Apply Allocations
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
