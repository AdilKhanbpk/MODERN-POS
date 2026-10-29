import React from 'react';
import { CounterInput } from '../../../../shared/types/onboarding';

interface Props {
  data: CounterInput;
  onChange: (data: CounterInput) => void;
  errors?: Record<string, string>;
}

export const Step6CounterSetup: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof CounterInput, value: string) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Checkout Counter (Register)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Configure your primary cash checkout counter or point-of-sale terminal.
        </p>
      </div>

      <div className="space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Counter Display Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.name || ''}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="e.g. Cash Counter 01, Express Register"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            {errors?.['counter.name'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['counter.name']}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Counter Code <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.code || ''}
              onChange={e => handleChange('code', e.target.value.toUpperCase())}
              placeholder="REG-01"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none uppercase transition"
            />
            {errors?.['counter.code'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['counter.code']}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Hardware / Terminal Device ID <span className="text-slate-500 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            value={data.deviceIdentifier || ''}
            onChange={e => handleChange('deviceIdentifier', e.target.value)}
            placeholder="e.g. POS-TERM-01, DESKTOP-MAIN"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none transition"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Unique machine identifier used to bind the local cash drawer and thermal printer to this station.
          </p>
        </div>
      </div>
    </div>
  );
};

