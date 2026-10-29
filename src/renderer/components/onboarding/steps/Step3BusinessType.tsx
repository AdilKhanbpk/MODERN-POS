import React from 'react';
import { BusinessTypeOption } from '../../../../shared/types/onboarding';
import { BUSINESS_TYPES_METADATA } from '../../../../domain/configuration/business-config';

interface Props {
  selectedType: BusinessTypeOption;
  onSelectType: (type: BusinessTypeOption, suggestedModules: string[]) => void;
  errors?: Record<string, string>;
}

export const Step3BusinessType: React.FC<Props> = ({ selectedType, onSelectType, errors }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Business Type & Vertical</h2>
        <p className="text-sm text-slate-400 mt-1">
          Select your primary retail trade. This tailors initial module recommendations (which you can customize at any time).
        </p>
      </div>

      {errors?.businessType && (
        <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300">
          {errors.businessType}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {BUSINESS_TYPES_METADATA.map(meta => {
          const isSelected = selectedType === meta.type;
          return (
            <div
              key={meta.type}
              onClick={() => onSelectType(meta.type, meta.suggestedModules)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500'
                  : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-900/70'
              }`}
            >
              <div className="flex items-start justify-between">
                <h3 className={`font-semibold text-sm ${isSelected ? 'text-indigo-200' : 'text-slate-200'}`}>
                  {meta.label}
                </h3>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    isSelected ? 'border-indigo-400 bg-indigo-500' : 'border-slate-600 bg-slate-900'
                  }`}
                >
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
              </div>

              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                {meta.description}
              </p>

              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap gap-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block w-full mb-1">
                  Suggested modules:
                </span>
                {meta.suggestedModules.map(mod => (
                  <span
                    key={mod}
                    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/60"
                  >
                    {mod.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

