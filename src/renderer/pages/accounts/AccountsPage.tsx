import React, { useState, useEffect } from 'react';
import { Account, JournalEntry } from '../../../shared/types';
import { BookOpenCheck, Plus, RefreshCw, X, Scale } from 'lucide-react';

export const AccountsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'accounts' | 'journal' | 'trial'>('accounts');
  const [loading, setLoading] = useState(true);

  // Manual JE modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [debitAccountId, setDebitAccountId] = useState<number>(1);
  const [creditAccountId, setCreditAccountId] = useState<number>(2);
  const [amountDecimal, setAmountDecimal] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      if (window.posApi?.accounts) {
        const [accList, jeList, tbList] = await Promise.all([
          window.posApi.accounts.list(),
          window.posApi.accounts.getJournalEntries(50),
          window.posApi.accounts.getTrialBalance()
        ]);
        setAccounts(accList);
        setJournalEntries(jeList);
        setTrialBalance(tbList);
        if (accList.length >= 2) {
          setDebitAccountId(accList[0].id);
          setCreditAccountId(accList[1].id);
        }
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

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cents = Math.round(parseFloat(amountDecimal) * 100);
      if (cents <= 0) throw new Error('Amount must be positive');
      if (debitAccountId === creditAccountId) throw new Error('Debit and Credit accounts must be different');

      await window.posApi.accounts.createManualEntry({
        description,
        lines: [
          { accountId: debitAccountId, debit: cents, credit: 0, memo: description },
          { accountId: creditAccountId, debit: 0, credit: cents, memo: description }
        ]
      });

      setIsModalOpen(false);
      setDescription('');
      setAmountDecimal('');
      loadData();
    } catch (err: any) {
      alert(`Error creating entry: ${err.message}`);
    }
  };

  const formatCents = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Double-Entry Financial Accounts</h1>
          <p className="text-xs text-slate-400">Strict double-entry general ledger, chart of accounts, and trial balance</p>
        </div>

        <div className="flex gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
            <button
              onClick={() => setActiveSubTab('accounts')}
              className={`px-3 py-1.5 rounded-lg transition ${activeSubTab === 'accounts' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Chart of Accounts
            </button>
            <button
              onClick={() => setActiveSubTab('journal')}
              className={`px-3 py-1.5 rounded-lg transition ${activeSubTab === 'journal' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Journal Entries
            </button>
            <button
              onClick={() => setActiveSubTab('trial')}
              className={`px-3 py-1.5 rounded-lg transition ${activeSubTab === 'trial' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Trial Balance
            </button>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> New Journal Entry
          </button>
          <button
            onClick={loadData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab: Chart of Accounts */}
      {activeSubTab === 'accounts' && (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Account Name</th>
                <th className="p-3">Classification</th>
                <th className="p-3 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-mono font-bold text-white">{acc.code}</td>
                  <td className="p-3 font-semibold text-slate-200">{acc.name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      {acc.type}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-emerald-400">
                    {formatCents(acc.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Journal Entries */}
      {activeSubTab === 'journal' && (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          {journalEntries.map((je) => (
            <div key={je.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800/60 mb-2">
                <div>
                  <span className="font-mono font-bold text-blue-400 text-xs">{je.entryNumber}</span>
                  <span className="text-slate-300 font-semibold text-xs ml-3">{je.description}</span>
                </div>
                <div className="text-slate-400 text-[11px] font-mono">
                  {new Date(je.createdAt).toLocaleString()}
                </div>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase">
                    <th className="py-1">Account</th>
                    <th className="py-1">Memo</th>
                    <th className="py-1 text-right">Debit</th>
                    <th className="py-1 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {je.lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-1.5 font-semibold text-slate-300">{l.accountCode} - {l.accountName}</td>
                      <td className="py-1.5 text-slate-400 text-[11px]">{l.memo}</td>
                      <td className="py-1.5 text-right font-mono text-amber-400">{l.debit > 0 ? formatCents(l.debit) : '-'}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-400">{l.credit > 0 ? formatCents(l.credit) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Trial Balance */}
      {activeSubTab === 'trial' && (
        <div className="flex-1 overflow-y-auto mt-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">Account Code</th>
                <th className="p-3">Account Title</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-right">Debit Balance</th>
                <th className="p-3 text-right">Credit Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {trialBalance.map((tb, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-mono font-bold text-white">{tb.code}</td>
                  <td className="p-3 font-semibold text-slate-200">{tb.name}</td>
                  <td className="p-3 text-slate-400">{tb.type}</td>
                  <td className="p-3 text-right font-mono text-amber-400">{tb.debit > 0 ? formatCents(tb.debit) : '-'}</td>
                  <td className="p-3 text-right font-mono text-emerald-400">{tb.credit > 0 ? formatCents(tb.credit) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Journal Entry Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Scale className="w-5 h-5 text-blue-400" />
                <span>Create Journal Entry</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEntry} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Entry Memo / Description</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Owner capital injection / Transfer"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Debit Account (+)</label>
                <select
                  value={debitAccountId}
                  onChange={(e) => setDebitAccountId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.type})</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Credit Account (-)</label>
                <select
                  value={creditAccountId}
                  onChange={(e) => setCreditAccountId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                >
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.type})</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Balanced Amount (Rs.)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amountDecimal}
                  onChange={(e) => setAmountDecimal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white text-base font-bold"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition mt-4"
              >
                Post Balanced Entry
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

