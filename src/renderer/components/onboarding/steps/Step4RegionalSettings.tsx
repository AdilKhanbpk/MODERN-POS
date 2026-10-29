import React from 'react';
import { RegionalSettingsInput } from '../../../../shared/types/onboarding';

interface Props {
  data: RegionalSettingsInput;
  onChange: (data: RegionalSettingsInput) => void;
  errors?: Record<string, string>;
}

export const Step4RegionalSettings: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof RegionalSettingsInput, value: any) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  const commonCurrencies = [
    { code: 'PKR', symbol: 'Rs. ', name: 'Pakistani Rupee' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'AED', symbol: 'AED ', name: 'UAE Dirham' },
    { code: 'SAR', symbol: 'SR ', name: 'Saudi Riyal' },
    { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
    { code: 'AUD', symbol: 'AU$', name: 'Australian Dollar' }
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Currency & Regional Settings</h2>
        <p className="text-sm text-slate-400 mt-1">
          Configure monetary representation, regional timezones, date formats, and measurement units.
        </p>
      </div>

      <div className="space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        {/* Currency Quick Presets & Code */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
            Base Currency Preset
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {commonCurrencies.map(c => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  handleChange('currencyCode', c.code);
                  handleChange('currencySymbol', c.symbol);
                }}
                className={`px-3 py-2 text-xs font-medium rounded-xl border transition text-left ${
                  data.currencyCode === c.code
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="font-bold">{c.code} ({c.symbol.trim()})</div>
                <div className="text-[10px] text-slate-400 truncate">{c.name}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Currency Code <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.currencyCode || ''}
              onChange={e => handleChange('currencyCode', e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="PKR"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none uppercase"
            />
            {errors?.['regionalSettings.currencyCode'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['regionalSettings.currencyCode']}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Symbol <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.currencySymbol || ''}
              onChange={e => handleChange('currencySymbol', e.target.value)}
              placeholder="Rs. "
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Decimal Places
            </label>
            <select
              value={data.currencyDecimals ?? 2}
              onChange={e => handleChange('currencyDecimals', parseInt(e.target.value, 10))}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value={2}>2 Decimals (Paisa/Cents: 100.00)</option>
              <option value={0}>0 Decimals (Whole numbers only: 100)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Timezone <span className="text-rose-400">*</span>
            </label>
            <select
              value={data.timezone || 'Asia/Karachi'}
              onChange={e => handleChange('timezone', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="Asia/Karachi">Asia/Karachi (PKT +05:00)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST +04:00)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (AST +03:00)</option>
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="America/New_York">America/New York (EST/EDT)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Default Measurement Unit
            </label>
            <select
              value={data.defaultMeasurementUnit || 'Piece'}
              onChange={e => handleChange('defaultMeasurementUnit', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="Piece">Piece (Count: pcs)</option>
              <option value="Kilogram">Kilogram (Weight: kg)</option>
              <option value="Litre">Litre (Volume: ltr)</option>
              <option value="Meter">Meter (Length: m)</option>
              <option value="Pack">Pack (Multi-pack)</option>
              <option value="Dozen">Dozen (12 count)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Date Format
            </label>
            <select
              value={data.dateFormat || 'DD/MM/YYYY'}
              onChange={e => handleChange('dateFormat', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY (28/10/2026)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-10-28)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (10/28/2026)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Time Format
            </label>
            <select
              value={data.timeFormat || '12h'}
              onChange={e => handleChange('timeFormat', e.target.value as '12h' | '24h')}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="12h">12-Hour (02:30 PM)</option>
              <option value="24h">24-Hour (14:30)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Receipt Language
            </label>
            <select
              value={data.receiptLanguage || 'en'}
              onChange={e => handleChange('receiptLanguage', e.target.value as 'en' | 'ur')}
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="en">English</option>
              <option value="ur">Urdu (اردو)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

