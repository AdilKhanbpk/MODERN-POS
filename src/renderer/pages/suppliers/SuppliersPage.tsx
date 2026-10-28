import React, { useState, useEffect } from 'react';
import { Supplier } from '../../../shared/types';
import { Building2, Plus, RefreshCw, X, DollarSign, History } from 'lucide-react';

export const SuppliersPage: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');

  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('Payment disbursed to supplier');

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      if (window.posApi?.suppliers) {
        const list = await window.posApi.suppliers.list();
        setSuppliers(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.posApi.suppliers.save({
        name,
        contactPerson,
        phone,
        isActive: true
      });
      setIsAddModalOpen(false);
      setName('');
      setPhone('');
      setContactPerson('');
      loadSuppliers();
    } catch (err: any) {
      alert(`Error saving supplier: ${err.message}`);
    }
  };

  const openPayModal = (s: Supplier) => {
    setSelectedSupplier(s);
    setPayAmount((s.balance / 100).toFixed(2));
    setIsPayModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    try {
      const amountCents = Math.round(parseFloat(payAmount) * 100);
      await window.posApi.suppliers.recordPayment(selectedSupplier.id, amountCents, payNotes);
      setIsPayModalOpen(false);
      loadSuppliers();
    } catch (err: any) {
      alert(`Payment error: ${err.message}`);
    }
  };

  const openLedgerModal = async (s: Supplier) => {
    setSelectedSupplier(s);
    try {
      const entries = await window.posApi.suppliers.getLedger(s.id);
      setLedgerEntries(entries);
      setIsLedgerModalOpen(true);
    } catch (err: any) {
      alert(`Error fetching supplier ledger: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Suppliers & Accounts Payable</h1>
          <p className="text-xs text-slate-400">Track vendor credit balances and payment disbursements</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Add Supplier
          </button>
          <button
            onClick={loadSuppliers}
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
              <th className="p-3">Supplier Name</th>
              <th className="p-3">Contact Person</th>
              <th className="p-3">Phone</th>
              <th className="p-3 text-right">Payable Balance</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {suppliers.map((s) => {
              const weOwe = s.balance > 0;
              return (
                <tr key={s.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-semibold text-white">{s.name}</td>
                  <td className="p-3 text-slate-300">{s.contactPerson || '-'}</td>
                  <td className="p-3 font-mono text-slate-300">{s.phone}</td>
                  <td className="p-3 text-right font-mono font-bold">
                    <span className={weOwe ? 'text-rose-400' : 'text-slate-400'}>
                      {formatCents(s.balance)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {weOwe && (
                        <button
                          onClick={() => openPayModal(s)}
                          className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <DollarSign className="w-3.5 h-3.5" /> Pay
                        </button>
                      )}
                      <button
                        onClick={() => openLedgerModal(s)}
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

      {/* Add Supplier Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">Add New Supplier</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddSupplier} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Company / Supplier Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="e.g. Metro Wholesale Distributors"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Contact Person</label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  placeholder="e.g. Usman Ali"
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
                  placeholder="03211234567"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Save Supplier
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Pay Supplier Modal */}
      {isPayModalOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Disburse Supplier Payment</h3>
                <p className="text-xs text-slate-400">{selectedSupplier.name} (Payable: {formatCents(selectedSupplier.balance)})</p>
              </div>
              <button onClick={() => setIsPayModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Amount Paid (Rs.)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-lg font-bold font-mono text-rose-400"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Notes / Voucher #</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 rounded-xl transition mt-4"
              >
                Disburse Payment
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Ledger Modal */}
      {isLedgerModalOpen && selectedSupplier && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Supplier Statement</h3>
                <p className="text-xs text-slate-400">{selectedSupplier.name}</p>
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
                    <th className="p-2.5 text-right">Debit (-)</th>
                    <th className="p-2.5 text-right">Credit (+)</th>
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
                      <td className="p-2.5 text-right font-mono text-emerald-400">{l.debit > 0 ? formatCents(l.debit) : '-'}</td>
                      <td className="p-2.5 text-right font-mono text-rose-400">{l.credit > 0 ? formatCents(l.credit) : '-'}</td>
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

