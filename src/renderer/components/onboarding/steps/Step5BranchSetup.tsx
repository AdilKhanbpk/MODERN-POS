import React from 'react';
import { BranchInput } from '../../../../shared/types/onboarding';

interface Props {
  data: BranchInput;
  onChange: (data: BranchInput) => void;
  errors?: Record<string, string>;
}

export const Step5BranchSetup: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof BranchInput, value: string) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Primary Store Branch</h2>
        <p className="text-sm text-slate-400 mt-1">
          Every counter and inventory balance belongs to a physical branch or store location.
        </p>
      </div>

      <div className="space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Branch Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.name || ''}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="e.g. Main Store, Headquarters, Downtown Branch"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            {errors?.['branch.name'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['branch.name']}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Branch Code <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.code || ''}
              onChange={e => handleChange('code', e.target.value.toUpperCase())}
              placeholder="HQ-01"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none uppercase transition"
            />
            {errors?.['branch.code'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['branch.code']}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Branch Phone <span className="text-slate-500 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            value={data.phone || ''}
            onChange={e => handleChange('phone', e.target.value)}
            placeholder="e.g. 051-1122334"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Branch Physical Address
          </label>
          <textarea
            rows={3}
            value={data.address || ''}
            onChange={e => handleChange('address', e.target.value)}
            placeholder="Branch street, building or market address"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
        </div>
      </div>
    </div>
  );
};

