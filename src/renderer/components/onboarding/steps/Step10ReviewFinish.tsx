import React from 'react';
import { OnboardingPayload } from '../../../../shared/types/onboarding';
import { BUSINESS_TYPES_METADATA } from '../../../../domain/configuration/business-config';

interface Props {
  payload: OnboardingPayload;
  isSubmitting: boolean;
  onFinish: () => void;
  onBackToStep: (step: number) => void;
  error?: string | null;
}

export const Step10ReviewFinish: React.FC<Props> = ({
  payload,
  isSubmitting,
  onFinish,
  onBackToStep,
  error
}) => {
  const typeMeta = BUSINESS_TYPES_METADATA.find(m => m.type === payload.businessType);

  return (
    <div className="max-w-3xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Review & Finalize Setup</h2>
        <p className="text-sm text-slate-400 mt-1">
          Verify your configuration details before initializing the POS database. Click any section to jump back and edit.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/50 border border-rose-500/50 rounded-2xl text-sm text-rose-300">
          <span className="font-bold">Setup Error: </span> {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Business & Regional Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              1. Business Profile & Regional Settings
            </h3>
            <button
              type="button"
              onClick={() => onBackToStep(2)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">Trade Name</span>
              <span className="text-white font-semibold">{payload.businessInfo.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Business Vertical</span>
              <span className="text-white font-semibold">{typeMeta?.label || payload.businessType}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Phone</span>
              <span className="text-white font-semibold">{payload.businessInfo.phone}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Currency</span>
              <span className="text-white font-semibold">
                {payload.regionalSettings.currencyCode} ({payload.regionalSettings.currencySymbol.trim()})
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Timezone</span>
              <span className="text-white font-semibold">{payload.regionalSettings.timezone}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Base Unit</span>
              <span className="text-white font-semibold">{payload.regionalSettings.defaultMeasurementUnit}</span>
            </div>
          </div>
        </div>

        {/* Branch & Register Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              2. Branch & Checkout Counter
            </h3>
            <button
              type="button"
              onClick={() => onBackToStep(5)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">Branch Name</span>
              <span className="text-white font-semibold">{payload.branch.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Branch Code</span>
              <span className="text-white font-mono font-semibold">{payload.branch.code}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Counter Name</span>
              <span className="text-white font-semibold">{payload.counter.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Counter Code</span>
              <span className="text-white font-mono font-semibold">{payload.counter.code}</span>
            </div>
          </div>
        </div>

        {/* Admin Account Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              3. Master Administrator Credentials
            </h3>
            <button
              type="button"
              onClick={() => onBackToStep(7)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">Full Name</span>
              <span className="text-white font-semibold">{payload.adminAccount.fullName}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Username</span>
              <span className="text-white font-mono font-semibold">{payload.adminAccount.username}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Password</span>
              <span className="text-slate-400">•••••••••• (bcrypt encrypted)</span>
            </div>
          </div>
        </div>

        {/* Modules Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              4. Active Optional Modules
            </h3>
            <button
              type="button"
              onClick={() => onBackToStep(8)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {payload.modules.enabledModuleCodes.length === 0 ? (
              <span className="text-xs text-slate-400">No optional modules enabled (Core engine only).</span>
            ) : (
              payload.modules.enabledModuleCodes.map(code => (
                <span
                  key={code}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono bg-indigo-950/60 border border-indigo-500/40 text-indigo-200"
                >
                  ✓ {code.replace('_', ' ')}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Receipt Settings Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              5. Receipt Template Layout
            </h3>
            <button
              type="button"
              onClick={() => onBackToStep(9)}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">Printed Heading</span>
              <span className="text-white font-semibold">{payload.receiptSettings.heading}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Thermal Width</span>
              <span className="text-white font-semibold">{payload.receiptSettings.paperWidth}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Customer / Cashier</span>
              <span className="text-white font-semibold">
                {payload.receiptSettings.showCustomerDetails ? 'Shown' : 'Hidden'} / {payload.receiptSettings.showCashierName ? 'Shown' : 'Hidden'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 text-center">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onFinish}
          className="inline-flex items-center px-10 py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-2xl shadow-xl shadow-emerald-600/30 transition transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
        >
          {isSubmitting ? (
            <span className="flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Initializing Database & Launching POS...</span>
            </span>
          ) : (
            <span>Complete Setup & Launch POS Terminal →</span>
          )}
        </button>
        <p className="text-xs text-slate-500 mt-2">
          Initializes SQLite tables, seeds default roles, and grants full owner permissions in a single atomic commit.
        </p>
      </div>
    </div>
  );
};

