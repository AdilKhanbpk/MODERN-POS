import React from 'react';
import { AdminAccountInput } from '../../../../shared/types/onboarding';

interface Props {
  data: AdminAccountInput;
  onChange: (data: AdminAccountInput) => void;
  errors?: Record<string, string>;
}

export const Step7AdminAccount: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof AdminAccountInput, value: string) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Administrator Account</h2>
        <p className="text-sm text-slate-400 mt-1">
          Create the master owner credentials. This account has unrestricted administrative privileges over sales, inventory, and ledger history.
        </p>
      </div>

      <div className="space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Administrator Full Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={data.fullName || ''}
            onChange={e => handleChange('fullName', e.target.value)}
            placeholder="e.g. Muhammad Usman, John Doe"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
          {errors?.['adminAccount.fullName'] && (
            <p className="text-xs text-rose-400 mt-1">{errors['adminAccount.fullName']}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Login Username <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={data.username || ''}
            onChange={e => handleChange('username', e.target.value.toLowerCase())}
            placeholder="e.g. admin, owner_usman"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none transition lowercase"
          />
          {errors?.['adminAccount.username'] && (
            <p className="text-xs text-rose-400 mt-1">{errors['adminAccount.username']}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Master Password <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={data.password || ''}
              onChange={e => handleChange('password', e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            {errors?.['adminAccount.password'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['adminAccount.password']}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Confirm Password <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={data.passwordConfirm || ''}
              onChange={e => handleChange('passwordConfirm', e.target.value)}
              placeholder="Re-enter password"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            {errors?.['adminAccount.passwordConfirm'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['adminAccount.passwordConfirm']}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Admin Email <span className="text-slate-500 font-normal">(Optional)</span>
            </label>
            <input
              type="email"
              value={data.email || ''}
              onChange={e => handleChange('email', e.target.value)}
              placeholder="admin@business.com"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Admin Phone <span className="text-slate-500 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={data.phone || ''}
              onChange={e => handleChange('phone', e.target.value)}
              placeholder="0300-1234567"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

