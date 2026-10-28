import React, { useState, useEffect } from 'react';
import { Customer } from '../../../shared/types';
import { Users, Plus, RefreshCw, X, CreditCard, History, DollarSign } from 'lucide-react';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);

  // Add form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimitDecimal, setCreditLimitDecimal] = useState('10000');

  // Payment form
  const [paymentAmountDecimal, setPaymentAmountDecimal] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('Cash payment towards dues');

  const loadCustomers = async () => {
    try {
      setLoading(true);
      if (window.posApi?.customers) {
        const list = await window.posApi.customers.list();
        setCustomers(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.posApi.customers.save({
        name,
        phone,
        creditLimit: Math.round(parseFloat(creditLimitDecimal || '0') * 100),
        isActive: true
      });
      setIsAddModalOpen(false);
      setName('');
      setPhone('');
      loadCustomers();
    } catch (err: any) {
      alert(`Error saving customer: ${err.message}`);
    }
  };

  const openPaymentModal = (c: Customer) => {
    setSelectedCustomer(c);
    setPaymentAmountDecimal((c.balance / 100).toFixed(2));
    setIsPayModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      const amountCents = Math.round(parseFloat(paymentAmountDecimal) * 100);
      await window.posApi.customers.recordPayment(selectedCustomer.id, amountCents, paymentNotes);
      setIsPayModalOpen(false);
      loadCustomers();
    } catch (err: any) {
      alert(`Error recording payment: ${err.message}`);
    }
  };

  const openLedgerModal = async (c: Customer) => {
    setSelectedCustomer(c);
    try {
      const entries = await window.posApi.customers.getLedger(c.id);
      setLedgerEntries(entries);
      setIsLedgerModalOpen(true);
    } catch (err: any) {
      alert(`Error fetching ledger: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Customer Accounts & Credit</h1>
          <p className="text-xs text-slate-400">Manage customer balances, credit limits, and receivable ledgers</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Add Customer
          </button>
          <button
            onClick={loadCustomers}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
            <tr>
              <th className="p-3">Customer Name</th>
              <th className="p-3">Phone</th>
              <th className="p-3 text-right">Credit Limit</th>
              <th className="p-3 text-right">Outstanding Balance</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {customers.map((c) => {
              const owesMoney = c.balance > 0;
              return (
                <tr key={c.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-semibold text-white">{c.name}</td>
                  <td className="p-3 font-mono text-slate-300">{c.phone}</td>
                  <td className="p-3 text-right font-mono text-slate-400">{formatCents(c.creditLimit)}</td>
                  <td className="p-3 text-right font-mono font-bold">
                    <span className={owesMoney ? 'text-amber-400' : 'text-emerald-400'}>
                      {formatCents(c.balance)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {owesMoney && (
                        <button
                          onClick={() => openPaymentModal(c)}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <DollarSign className="w-3.5 h-3.5" /> Settle
                        </button>
                      )}
                      <button
                        onClick={() => openLedgerModal(c)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                        title="View Ledger"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">Add Customer</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddCustomer} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Customer Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="e.g. Ahmad Khan"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  placeholder="03001234567"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Max Credit Limit (Rs.)</label>
                <input
                  type="number"
                  value={creditLimitDecimal}
                  onChange={(e) => setCreditLimitDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Save Customer
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Settle Customer Dues Modal */}
      {isPayModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Receive Customer Payment</h3>
                <p className="text-xs text-slate-400">{selectedCustomer.name} (Due: {formatCents(selectedCustomer.balance)})</p>
              </div>
              <button onClick={() => setIsPayModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Amount Received (Rs.)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmountDecimal}
                  onChange={(e) => setPaymentAmountDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-lg font-bold font-mono text-emerald-400"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Payment Memo / Receipt #</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition mt-4"
              >
                Record Payment
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Customer Ledger History Modal */}
      {isLedgerModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Customer Statement / Ledger</h3>
                <p className="text-xs text-slate-400">{selectedCustomer.name} ({selectedCustomer.phone})</p>
              </div>
              <button onClick={() => setIsLedgerModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0">
                  <tr>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5 text-right">Debit (+)</th>
                    <th className="p-2.5 text-right">Credit (-)</th>
                    <th className="p-2.5 text-right">Balance</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {ledgerEntries.map((l) => (
                    <tr key={l.id}>
                      <td className="p-2.5 font-mono text-[11px] text-slate-400">
                        {new Date(l.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-2.5 font-semibold text-slate-300">{l.transactionType}</td>
                      <td className="p-2.5 text-right font-mono text-amber-400">{l.debit > 0 ? formatCents(l.debit) : '-'}</td>
                      <td className="p-2.5 text-right font-mono text-emerald-400">{l.credit > 0 ? formatCents(l.credit) : '-'}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-white">{formatCents(l.runningBalance)}</td>
                      <td className="p-2.5 text-slate-400">{l.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

