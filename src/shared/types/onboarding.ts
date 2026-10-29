/**
 * Shared: Onboarding and Business Configuration Types
 * Covers the 10-step first-run onboarding workflow for single store and enterprise operations.
 */

export type BusinessTypeOption =
  | 'GROCERY'
  | 'SUPERMARKET'
  | 'PHARMACY'
  | 'APPAREL'
  | 'CLOTHING'
  | 'SHOES'
  | 'COSMETICS'
  | 'BEVERAGES'
  | 'ELECTRONICS'
  | 'LABORATORY'
  | 'WHOLESALE'
  | 'GENERAL_RETAIL'
  | 'OTHER';

export interface BusinessTypeMetadata {
  type: BusinessTypeOption;
  label: string;
  description: string;
  suggestedModules: string[];
}

export interface BusinessInfoInput {
  name: string;
  legalName?: string;
  registrationNumber?: string;
  phone: string;
  email?: string;
  address?: string;
}

export interface RegionalSettingsInput {
  currencyCode: string; // ISO 4217 (e.g. 'PKR', 'USD', 'EUR', 'GBP', 'SAR', 'AED')
  currencySymbol: string; // e.g. 'Rs. ', '$', '€', '£', 'AED '
  currencyDecimals: number; // 0 or 2
  timezone: string; // e.g. 'Asia/Karachi', 'UTC', 'America/New_York', 'Asia/Dubai'
  dateFormat: string; // 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'
  timeFormat: '12h' | '24h';
  numberFormat: 'standard' | 'european'; // 1,234.56 vs 1.234,56
  receiptLanguage: 'en' | 'ur';
  defaultMeasurementUnit: string; // 'Piece', 'Kilogram', 'Litre', 'Meter', 'Pack', 'Dozen'
}

export interface BranchInput {
  name: string;
  code: string;
  address?: string;
  phone?: string;
}

export interface CounterInput {
  name: string;
  code: string;
  deviceIdentifier?: string;
}

export interface AdminAccountInput {
  fullName: string;
  username: string;
  password: string;
  passwordConfirm?: string;
  email?: string;
  phone?: string;
}

export interface ModuleSelectionInput {
  enabledModuleCodes: string[];
  moduleConfigs?: Record<string, Record<string, any>>;
}

export interface ReceiptSettingsInput {
  displayName: string;
  address?: string;
  phone?: string;
  heading?: string; // e.g. "SALE INVOICE", "CASH MEMO", "TAX INVOICE"
  footerMessage?: string; // e.g. "Thank you for shopping with us! Goods once sold can be exchanged within 7 days."
  logoPath?: string;
  paperWidth: '58mm' | '80mm' | 'A4';
  showCustomerDetails?: boolean;
  showTaxDetails?: boolean;
  showCashierName?: boolean;
  showBarcodeOrQr?: boolean;
}

export interface OnboardingPayload {
  businessInfo: BusinessInfoInput;
  businessType: BusinessTypeOption;
  regionalSettings: RegionalSettingsInput;
  branch: BranchInput;
  counter: CounterInput;
  adminAccount: AdminAccountInput;
  modules: ModuleSelectionInput;
  receiptSettings: ReceiptSettingsInput;
}

export interface OnboardingDraft {
  currentStep: number;
  payload: Partial<OnboardingPayload>;
  savedAt: string;
}

export interface OnboardingStatus {
  isCompleted: boolean;
  activeBusinessId?: string;
  businessName?: string;
  hasDraft: boolean;
  draftStep?: number;
}

export interface ModuleDefinitionWithEnables {
  id: string;
  moduleCode: string;
  moduleName: string;
  description?: string;
  enables?: string;
  isCore: boolean;
  dependencies?: string[];
  isEnabled?: boolean;
}

