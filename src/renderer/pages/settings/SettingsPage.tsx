import React, { useState, useEffect } from 'react';
import { SystemSettings } from '../../../shared/types';
import { Settings, Save, Database, Download, History, Check, AlertCircle } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SystemSettings>({
    storeName: '',
    storeAddress: '',
    storePhone: '',
    currencySymbol: 'Rs. ',
    currencyCode: 'PKR',
    defaultTaxRate: 0,
    isTaxInclusive: true,
    receiptHeader: '',
    receiptFooter: '',
    autoPrintReceipt: true,
    backupPath: './backups',
    autoBackupOnClose: true
  });
  const [backups, setBackups] = useState<any[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [backupSuccessMsg, setBackupSuccessMsg] = useState<string | null>(null);

  const loadData = async () => {
    try {
      if (window.posApi?.settings) {
        const s = await window.posApi.settings.get();
        setSettings(s);
      }
      if (window.posApi?.backup) {
        const list = await window.posApi.backup.list();
        setBackups(list);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (window.posApi?.settings) {
        await window.posApi.settings.save(settings);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch (err: any) {
      alert(`Error saving settings: ${err.message}`);
    }
  };

  const handleCreateBackup = async () => {
    try {
      if (window.posApi?.backup) {
        const res = await window.posApi.backup.create();
        setBackupSuccessMsg(`Backup created at: ${res.filePath} (${(res.sizeBytes / 1024).toFixed(1)} KB)`);
        loadData();
        setTimeout(() => setBackupSuccessMsg(null), 5000);
      }
    } catch (err: any) {
      alert(`Backup error: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">Store Settings & Data Backup</h1>
          <p className="text-xs text-slate-400">Configure store branding, receipt layout, and local offline backups</p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-semibold">
            <Check className="w-4 h-4" /> Settings Saved!
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Store Profile Form */}
        <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 text-xs">
          <h2 className="text-sm font-bold text-white mb-2">Store Profile & Printing</h2>

          <div>
            <label className="text-slate-400 block mb-1">Store / Business Name</label>
            <input
              type="text"
              required
              value={settings.storeName}
              onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">Contact Phone</label>
              <input
                type="text"
                value={settings.storePhone}
                onChange={(e) => setSettings({ ...settings, storePhone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Currency Symbol</label>
              <input
                type="text"
                value={settings.currencySymbol}
                onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Store Address</label>
            <input
              type="text"
              value={settings.storeAddress}
              onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Receipt Top Header Note</label>
            <input
              type="text"
              value={settings.receiptHeader}
              onChange={(e) => setSettings({ ...settings, receiptHeader: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Receipt Bottom Footer Note</label>
            <textarea
              rows={2}
              value={settings.receiptFooter}
              onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white resize-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20"
            >
              <Save className="w-4 h-4" /> Save Configuration
            </button>
          </div>
        </form>

        {/* Database Backup Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>SQLite Database Offline Backups</span>
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            Safe live atomic snapshots created using SQLite's VACUUM INTO engine. No cloud connection required.
          </p>

          {backupSuccessMsg && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{backupSuccessMsg}</span>
            </div>
          )}

          <button
            onClick={handleCreateBackup}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 text-xs shadow-md shadow-emerald-600/20 mb-6"
          >
            <Download className="w-4 h-4" />
            <span>Generate Backup Snapshot Now</span>
          </button>

          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            <span>Existing Backups on Disk</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 max-h-60">
            {backups.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs bg-slate-950 rounded-xl border border-slate-800">
                No backup files found yet. Click above to take a manual snapshot.
              </div>
            ) : (
              backups.map((b, idx) => (
                <div key={idx} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-mono text-white text-[11px] font-semibold">{b.fileName}</div>
                    <div className="text-[10px] text-slate-500">{new Date(b.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="font-mono text-slate-400 text-[11px]">
                    {(b.sizeBytes / 1024).toFixed(1)} KB
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

