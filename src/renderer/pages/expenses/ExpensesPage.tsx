import React, { useState, useEffect } from 'react';
import { Expense } from '../../../shared/types';
import { Receipt, Plus, RefreshCw, X } from 'lucide-react';

export const ExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [categoryId, setCategoryId] = useState<number>(1);
  const [paidFromAccountId, setPaidFromAccountId] = useState<number>(1);
  const [amountDecimal, setAmountDecimal] = useState('');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi) {
        const [expList, catList, accList] = await Promise.all([
          window.posApi.expenses.list(),
          window.posApi.expenses.listCategories(),
          window.posApi.accounts.list()
        ]);
        setExpenses(expList);
        setCategories(catList);
        setAccounts(accList);
        if (catList.length > 0) setCategoryId(catList[0].id);
        if (accList.length > 0) setPaidFromAccountId(accList[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amountCents = Math.round(parseFloat(amountDecimal) * 100);
      await window.posApi.expenses.create({
        expenseCategoryId: categoryId,
        paidFromAccountId,
        amount: amountCents,
        recipient,
        notes
      });
      setIsModalOpen(false);
      setAmountDecimal('');
      setRecipient('');
      setNotes('');
      loadData();
    } catch (err: any) {
      alert(`Error recording expense: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Operating Expenses</h1>
          <p className="text-xs text-slate-400">Log daily store overheads, utilities, maintenance, and petty cash</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Log Expense
          </button>
          <button
            onClick={loadData}
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
              <th className="p-3">Category</th>
              <th className="p-3">Paid From Account</th>
              <th className="p-3">Recipient</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Notes</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No expenses recorded yet.
                </td>
              </tr>
            ) : (
              expenses.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-semibold text-white">{e.categoryName || 'General'}</td>
                  <td className="p-3 text-slate-400">{e.accountName || 'Cash'}</td>
                  <td className="p-3 text-slate-300">{e.recipient || '-'}</td>
                  <td className="p-3 text-right font-mono font-bold text-rose-400">{formatCents(e.amount)}</td>
                  <td className="p-3 text-slate-400">{e.notes}</td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Log Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">Record Operating Expense</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateExpense} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Expense Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Paid From Account</label>
                <select
                  value={paidFromAccountId}
                  onChange={(e) => setPaidFromAccountId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Amount Paid (Rs.)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amountDecimal}
                  onChange={(e) => setAmountDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base font-bold font-mono text-rose-400"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Paid To / Recipient</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="e.g. Landlord, Electric Company, Cleaner"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Memo / Purpose</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Monthly electricity bill payment"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Save Expense
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

