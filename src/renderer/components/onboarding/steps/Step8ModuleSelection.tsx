import React from 'react';
import { ModuleDefinitionWithEnables } from '../../../../shared/types/onboarding';

interface Props {
  modules: ModuleDefinitionWithEnables[];
  enabledModuleCodes: string[];
  onToggleModule: (code: string) => void;
  errors?: Record<string, string>;
}

export const Step8ModuleSelection: React.FC<Props> = ({
  modules,
  enabledModuleCodes,
  onToggleModule,
  errors
}) => {
  const coreModules = modules.filter(m => m.isCore);
  const optionalModules = modules.filter(m => !m.isCore);

  const isEnabled = (code: string) => enabledModuleCodes.includes(code);

  const getDependencyStatus = (mod: ModuleDefinitionWithEnables) => {
    if (!mod.dependencies || mod.dependencies.length === 0) return null;
    const missing = mod.dependencies.filter(d => !isEnabled(d));
    const depNames = mod.dependencies.map(d => {
      const match = modules.find(m => m.moduleCode === d);
      return match ? match.moduleName : d;
    });

    return {
      requiredNames: depNames,
      isSatisfied: missing.length === 0
    };
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Optional Module Selection</h2>
        <p className="text-sm text-slate-400 mt-1">
          Enable or disable capabilities based on your operational workflow. You can freely change these at any time post-setup.
        </p>
      </div>

      {errors?.['modules.dependencies'] && (
        <div className="p-4 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300">
          <span className="font-bold">Dependency Warning: </span>
          {errors['modules.dependencies']}
        </div>
      )}

      {/* Core Modules (Always Active) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Core Engine Modules (Always Active & Protected)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {coreModules.map(mod => (
            <div
              key={mod.id}
              className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-1.5 opacity-90"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400">{mod.moduleName}</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">
                  Core
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">{mod.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Optional Feature Modules */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Configurable Optional Modules
        </h3>
        <div className="space-y-3">
          {optionalModules.map(mod => {
            const active = isEnabled(mod.moduleCode);
            const depInfo = getDependencyStatus(mod);

            return (
              <div
                key={mod.id}
                className={`p-4 rounded-xl border transition-all ${
                  active
                    ? 'bg-slate-900/90 border-indigo-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center space-x-2.5">
                      <h4 className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-300'}`}>
                        {mod.moduleName}
                      </h4>
                      {depInfo && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                            depInfo.isSatisfied
                              ? 'bg-slate-800 text-slate-300 border-slate-700'
                              : 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          Requires: {depInfo.requiredNames.join(', ')}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 leading-normal">
                      {mod.description}
                    </p>

                    {mod.enables && (
                      <div className="text-[11px] text-slate-400 pt-1">
                        <span className="font-semibold text-slate-300">Enables: </span>
                        {mod.enables}
                      </div>
                    )}
                  </div>

                  {/* Toggle Switch */}
                  <div className="pt-0.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => onToggleModule(mod.moduleCode)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        active ? 'bg-indigo-600' : 'bg-slate-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          active ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

