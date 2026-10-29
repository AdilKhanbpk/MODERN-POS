import React from 'react';
import { OnboardingDraft } from '../../../../shared/types/onboarding';

interface Props {
  hasDraft: boolean;
  draft: OnboardingDraft | null;
  onResumeDraft: () => void;
  onStartFresh: () => void;
  onContinue: () => void;
}

export const Step1Welcome: React.FC<Props> = ({
  hasDraft,
  draft,
  onResumeDraft,
  onStartFresh,
  onContinue
}) => {
  return (
    <div className="max-w-3xl mx-auto py-8 text-slate-100">
      <div className="text-center space-y-4 mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-4xl font-bold shadow-lg shadow-indigo-500/10 mb-2">
          POS
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Welcome to Modern Retail POS
        </h1>
        <p className="text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
          Set up your store in 10 simple guided steps. Designed for 100% offline reliability — whether you are running a single neighborhood grocery shop or an enterprise wholesale chain.
        </p>
      </div>

      {hasDraft && draft && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-5 mb-8 shadow-md">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
                <h3 className="text-amber-200 font-semibold text-sm uppercase tracking-wider">
                  Unfinished Setup Found
                </h3>
              </div>
              <p className="text-sm text-amber-300/80">
                You have a saved setup session from <span className="text-amber-200 font-medium">{new Date(draft.savedAt).toLocaleDateString()}</span> at Step {draft.currentStep} ({draft.payload.businessInfo?.name || 'Unnamed Business'}).
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onStartFresh}
                className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              >
                Start Over
              </button>
              <button
                type="button"
                onClick={onResumeDraft}
                className="px-4 py-1.5 text-xs font-semibold text-amber-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow transition"
              >
                Resume Step {draft.currentStep} →
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-emerald-400 text-xl font-bold">100% Offline First</div>
          <p className="text-xs text-slate-400 leading-normal">
            No cloud dependency. Fast local SQLite database keeps sales, stock, and customer khata running even during power or internet outages.
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-cyan-400 text-xl font-bold">Tailored to Your Trade</div>
          <p className="text-xs text-slate-400 leading-normal">
            Select your retail vertical — grocery, pharmacy, apparel, electronics, or wholesale — and activate only the modules you need.
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-purple-400 text-xl font-bold">Zero Tech Hassle</div>
          <p className="text-xs text-slate-400 leading-normal">
            No database administrator or developer required. Configure receipt templates, initial counter, and admin credentials in minutes.
          </p>
        </div>
      </div>

      <div className="text-center pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center px-8 py-3.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition transform hover:-translate-y-0.5 active:translate-y-0"
        >
          Begin Store Setup →
        </button>
      </div>
    </div>
  );
};

