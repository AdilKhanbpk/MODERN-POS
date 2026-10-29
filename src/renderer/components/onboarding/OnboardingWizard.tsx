import React, { useState, useEffect } from 'react';
import {
  OnboardingPayload,
  OnboardingDraft,
  ModuleDefinitionWithEnables,
  BusinessTypeOption
} from '../../../shared/types/onboarding';
import { Step1Welcome } from './steps/Step1Welcome';
import { Step2BusinessInfo } from './steps/Step2BusinessInfo';
import { Step3BusinessType } from './steps/Step3BusinessType';
import { Step4RegionalSettings } from './steps/Step4RegionalSettings';
import { Step5BranchSetup } from './steps/Step5BranchSetup';
import { Step6CounterSetup } from './steps/Step6CounterSetup';
import { Step7AdminAccount } from './steps/Step7AdminAccount';
import { Step8ModuleSelection } from './steps/Step8ModuleSelection';
import { Step9ReceiptConfig } from './steps/Step9ReceiptConfig';
import { Step10ReviewFinish } from './steps/Step10ReviewFinish';
import { validateOnboardingPayload } from '../../../shared/validators/onboarding-validator';

interface Props {
  onComplete: () => void;
}

const INITIAL_PAYLOAD: OnboardingPayload = {
  businessInfo: {
    name: '',
    legalName: '',
    registrationNumber: '',
    phone: '',
    email: '',
    address: ''
  },
  businessType: 'GENERAL_RETAIL',
  regionalSettings: {
    currencyCode: 'PKR',
    currencySymbol: 'Rs. ',
    currencyDecimals: 2,
    timezone: 'Asia/Karachi',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    numberFormat: 'standard',
    receiptLanguage: 'en',
    defaultMeasurementUnit: 'Piece'
  },
  branch: {
    name: 'Main Store',
    code: 'HQ-01',
    address: '',
    phone: ''
  },
  counter: {
    name: 'Cash Counter 01',
    code: 'REG-01',
    deviceIdentifier: 'POS-TERM-01'
  },
  adminAccount: {
    fullName: '',
    username: 'admin',
    password: '',
    passwordConfirm: '',
    email: '',
    phone: ''
  },
  modules: {
    enabledModuleCodes: ['customer_ledger', 'supplier_payables']
  },
  receiptSettings: {
    displayName: '',
    address: '',
    phone: '',
    heading: 'SALE INVOICE',
    footerMessage: 'Thank you for shopping with us! Goods once sold can be exchanged within 7 days.',
    paperWidth: '80mm',
    showCustomerDetails: true,
    showTaxDetails: true,
    showCashierName: true,
    showBarcodeOrQr: true
  }
};

const STEP_TITLES = [
  'Welcome',
  'Business Info',
  'Business Type',
  'Regional',
  'Branch',
  'Counter',
  'Admin User',
  'Modules',
  'Receipt',
  'Finish'
];

export const OnboardingWizard: React.FC<Props> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [payload, setPayload] = useState<OnboardingPayload>(INITIAL_PAYLOAD);
  const [modulesCatalog, setModulesCatalog] = useState<ModuleDefinitionWithEnables[]>([]);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [hasDraft, setHasDraft] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSavedToast, setDraftSavedToast] = useState<boolean>(false);

  // Load modules catalog and existing draft on mount
  useEffect(() => {
    async function init() {
      try {
        if (window.posApi?.onboarding) {
          const [mods, loadedDraft] = await Promise.all([
            window.posApi.onboarding.getModuleDefinitions(),
            window.posApi.onboarding.getDraft()
          ]);
          setModulesCatalog(mods || []);
          if (loadedDraft) {
            setDraft(loadedDraft);
            setHasDraft(true);
          }
        }
      } catch (err) {
        console.error('Failed to initialize onboarding data:', err);
      }
    }
    init();
  }, []);

  // When business info name updates, auto-populate receipt displayName if empty
  const handleBusinessInfoChange = (info: typeof payload.businessInfo) => {
    setPayload(prev => ({
      ...prev,
      businessInfo: info,
      receiptSettings: {
        ...prev.receiptSettings,
        displayName: prev.receiptSettings.displayName || info.name.toUpperCase(),
        phone: prev.receiptSettings.phone || info.phone,
        address: prev.receiptSettings.address || info.address || ''
      },
      branch: {
        ...prev.branch,
        phone: prev.branch.phone || info.phone,
        address: prev.branch.address || info.address || ''
      }
    }));
  };

  // When business type is selected, pre-select suggested modules
  const handleBusinessTypeSelect = (type: BusinessTypeOption, suggestedModules: string[]) => {
    setPayload(prev => ({
      ...prev,
      businessType: type,
      modules: {
        ...prev.modules,
        enabledModuleCodes: Array.from(new Set([...suggestedModules]))
      }
    }));
  };

  // Toggle optional module
  const handleToggleModule = (code: string) => {
    setPayload(prev => {
      const current = prev.modules.enabledModuleCodes;
      const isAlready = current.includes(code);
      let updated: string[];

      if (isAlready) {
        // Disabling: also check if any other enabled module requires this one
        const dependents = modulesCatalog.filter(
          m => m.dependencies && m.dependencies.includes(code) && current.includes(m.moduleCode)
        );
        if (dependents.length > 0) {
          setErrors({
            'modules.dependencies': `Cannot disable because active module(s) [${dependents.map(d => d.moduleName).join(', ')}] depend on it.`
          });
          return prev;
        }
        updated = current.filter(c => c !== code);
      } else {
        // Enabling: automatically include any required dependencies if not already enabled
        const targetDef = modulesCatalog.find(m => m.moduleCode === code);
        const requiredDeps = targetDef?.dependencies || [];
        updated = Array.from(new Set([...current, code, ...requiredDeps]));
      }

      setErrors(prevErr => {
        const copy = { ...prevErr };
        delete copy['modules.dependencies'];
        return copy;
      });

      return {
        ...prev,
        modules: {
          ...prev.modules,
          enabledModuleCodes: updated
        }
      };
    });
  };

  // Save incomplete draft
  const handleSaveDraft = async () => {
    try {
      if (window.posApi?.onboarding) {
        await window.posApi.onboarding.saveDraft({
          currentStep,
          payload,
          savedAt: new Date().toISOString()
        });
        setDraftSavedToast(true);
        setTimeout(() => setDraftSavedToast(false), 3000);
      }
    } catch (err) {
      console.error('Failed to save onboarding draft:', err);
    }
  };

  // Resume saved draft
  const handleResumeDraft = () => {
    if (draft && draft.payload) {
      setPayload(prev => ({
        ...prev,
        ...draft.payload
      }));
      setCurrentStep(draft.currentStep || 2);
    }
  };

  // Start over
  const handleStartFresh = async () => {
    try {
      if (window.posApi?.onboarding) {
        await window.posApi.onboarding.clearDraft();
      }
    } catch (err) {
      console.error('Failed to clear draft:', err);
    }
    setDraft(null);
    setHasDraft(false);
    setPayload(INITIAL_PAYLOAD);
    setCurrentStep(1);
  };

  // Validate step before advancing
  const handleContinue = () => {
    const newErrors: Record<string, string> = {};

    if (currentStep === 2) {
      if (!payload.businessInfo.name || payload.businessInfo.name.trim().length < 2) {
        newErrors['businessInfo.name'] = 'Business name is required (min 2 characters)';
      }
      if (!payload.businessInfo.phone || payload.businessInfo.phone.trim().length < 5) {
        newErrors['businessInfo.phone'] = 'A valid phone number is required';
      }
    } else if (currentStep === 4) {
      if (!payload.regionalSettings.currencyCode || !/^[A-Z]{3}$/.test(payload.regionalSettings.currencyCode)) {
        newErrors['regionalSettings.currencyCode'] = 'Valid 3-letter currency code required (e.g. PKR)';
      }
    } else if (currentStep === 5) {
      if (!payload.branch.name || payload.branch.name.trim().length < 2) {
        newErrors['branch.name'] = 'Branch name is required';
      }
      if (!payload.branch.code || payload.branch.code.trim().length < 2) {
        newErrors['branch.code'] = 'Branch code is required (e.g. HQ-01)';
      }
    } else if (currentStep === 6) {
      if (!payload.counter.name || payload.counter.name.trim().length < 2) {
        newErrors['counter.name'] = 'Counter name is required';
      }
      if (!payload.counter.code || payload.counter.code.trim().length < 2) {
        newErrors['counter.code'] = 'Counter code is required (e.g. REG-01)';
      }
    } else if (currentStep === 7) {
      if (!payload.adminAccount.fullName || payload.adminAccount.fullName.trim().length < 2) {
        newErrors['adminAccount.fullName'] = 'Full name is required';
      }
      if (!payload.adminAccount.username || !/^[a-zA-Z0-9_]{3,30}$/.test(payload.adminAccount.username)) {
        newErrors['adminAccount.username'] = 'Username must be 3-30 letters, numbers, or underscore';
      }
      if (!payload.adminAccount.password || payload.adminAccount.password.length < 6) {
        newErrors['adminAccount.password'] = 'Password must be at least 6 characters';
      }
      if (payload.adminAccount.password !== payload.adminAccount.passwordConfirm) {
        newErrors['adminAccount.passwordConfirm'] = 'Passwords do not match';
      }
    } else if (currentStep === 9) {
      if (!payload.receiptSettings.displayName || payload.receiptSettings.displayName.trim().length < 2) {
        newErrors['receiptSettings.displayName'] = 'Receipt business display name is required';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setCurrentStep(prev => Math.min(10, prev + 1));
  };

  const handleBack = () => {
    setErrors({});
    setCurrentStep(prev => Math.max(1, prev - 1));
  };

  // Complete onboarding
  const handleFinish = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (window.posApi?.onboarding) {
        await window.posApi.onboarding.complete(payload);
        onComplete();
      }
    } catch (err: any) {
      console.error('Onboarding completion error:', err);
      setSubmitError(err.message || 'Failed to complete store setup. Please check input fields.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Header Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow shadow-indigo-500/20">
              POS
            </span>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">
                Initial Store Onboarding & Setup
              </h1>
              <p className="text-[11px] text-slate-400">
                Step {currentStep} of 10 — {STEP_TITLES[currentStep - 1]}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {draftSavedToast && (
              <span className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-3 py-1 rounded-lg animate-fade">
                ✓ Draft saved safely
              </span>
            )}

            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleSaveDraft}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              >
                Save Draft
              </button>
            )}
          </div>
        </div>

        {/* 10-Step Progress Dots & Bar */}
        <div className="max-w-6xl mx-auto mt-4">
          <div className="grid grid-cols-10 gap-1.5">
            {STEP_TITLES.map((title, idx) => {
              const stepNum = idx + 1;
              const isPast = stepNum < currentStep;
              const isCurrent = stepNum === currentStep;

              return (
                <div key={title} className="flex flex-col space-y-1">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      isCurrent
                        ? 'bg-indigo-500 ring-2 ring-indigo-500/30'
                        : isPast
                        ? 'bg-emerald-500'
                        : 'bg-slate-800'
                    }`}
                  />
                  <span
                    className={`text-[9px] font-medium truncate ${
                      isCurrent
                        ? 'text-indigo-400 font-bold'
                        : isPast
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {stepNum}. {title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Form Body */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-5xl mx-auto">
          {currentStep === 1 && (
            <Step1Welcome
              hasDraft={hasDraft}
              draft={draft}
              onResumeDraft={handleResumeDraft}
              onStartFresh={handleStartFresh}
              onContinue={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <Step2BusinessInfo
              data={payload.businessInfo}
              onChange={handleBusinessInfoChange}
              errors={errors}
            />
          )}

          {currentStep === 3 && (
            <Step3BusinessType
              selectedType={payload.businessType}
              onSelectType={handleBusinessTypeSelect}
              errors={errors}
            />
          )}

          {currentStep === 4 && (
            <Step4RegionalSettings
              data={payload.regionalSettings}
              onChange={data => setPayload(prev => ({ ...prev, regionalSettings: data }))}
              errors={errors}
            />
          )}

          {currentStep === 5 && (
            <Step5BranchSetup
              data={payload.branch}
              onChange={data => setPayload(prev => ({ ...prev, branch: data }))}
              errors={errors}
            />
          )}

          {currentStep === 6 && (
            <Step6CounterSetup
              data={payload.counter}
              onChange={data => setPayload(prev => ({ ...prev, counter: data }))}
              errors={errors}
            />
          )}

          {currentStep === 7 && (
            <Step7AdminAccount
              data={payload.adminAccount}
              onChange={data => setPayload(prev => ({ ...prev, adminAccount: data }))}
              errors={errors}
            />
          )}

          {currentStep === 8 && (
            <Step8ModuleSelection
              modules={modulesCatalog}
              enabledModuleCodes={payload.modules.enabledModuleCodes}
              onToggleModule={handleToggleModule}
              errors={errors}
            />
          )}

          {currentStep === 9 && (
            <Step9ReceiptConfig
              data={payload.receiptSettings}
              onChange={data => setPayload(prev => ({ ...prev, receiptSettings: data }))}
              errors={errors}
            />
          )}

          {currentStep === 10 && (
            <Step10ReviewFinish
              payload={payload}
              isSubmitting={isSubmitting}
              onFinish={handleFinish}
              onBackToStep={setCurrentStep}
              error={submitError}
            />
          )}
        </div>
      </main>

      {/* Persistent Bottom Action Bar (Steps 2-9) */}
      {currentStep > 1 && currentStep < 10 && (
        <footer className="border-t border-slate-800/80 bg-slate-900/80 backdrop-blur px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <button
              type="button"
              onClick={handleBack}
              className="px-5 py-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition"
            >
              ← Back
            </button>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700 transition"
              >
                Save Draft
              </button>

              <button
                type="button"
                onClick={handleContinue}
                className="px-7 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-md shadow-indigo-600/30 transition transform hover:-translate-y-0.5 active:translate-y-0"
              >
                Continue →
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};

