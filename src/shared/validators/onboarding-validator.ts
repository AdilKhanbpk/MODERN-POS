import { OnboardingPayload, BusinessTypeOption } from '../types/onboarding';
import { BUSINESS_TYPES_METADATA, validateModuleDependencies, ModuleDefLike } from '../../domain/configuration/business-config';
import { ValidationError } from '../errors/AppError';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateOnboardingPayload(
  payload: OnboardingPayload,
  moduleCatalog: ModuleDefLike[] = []
): ValidationResult {
  const errors: Record<string, string> = {};

  // 1. Business Info
  if (!payload.businessInfo?.name || payload.businessInfo.name.trim().length < 2) {
    errors['businessInfo.name'] = 'Business name is required (minimum 2 characters)';
  }
  if (!payload.businessInfo?.phone || payload.businessInfo.phone.trim().length < 5) {
    errors['businessInfo.phone'] = 'A valid business phone number is required';
  }
  if (payload.businessInfo?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.businessInfo.email)) {
    errors['businessInfo.email'] = 'Invalid business email format';
  }

  // 2. Business Type
  const validTypes = BUSINESS_TYPES_METADATA.map(m => m.type);
  if (!payload.businessType || !validTypes.includes(payload.businessType)) {
    errors['businessType'] = `Invalid business type. Must be one of: ${validTypes.join(', ')}`;
  }

  // 3. Regional Settings
  if (!payload.regionalSettings?.currencyCode || !/^[A-Z]{3}$/.test(payload.regionalSettings.currencyCode)) {
    errors['regionalSettings.currencyCode'] = 'Currency code must be a valid 3-letter ISO code (e.g. PKR, USD, EUR)';
  }
  if (!payload.regionalSettings?.currencySymbol || payload.regionalSettings.currencySymbol.trim().length === 0) {
    errors['regionalSettings.currencySymbol'] = 'Currency symbol is required (e.g. Rs. , $, €)';
  }
  if (![0, 2].includes(payload.regionalSettings?.currencyDecimals)) {
    errors['regionalSettings.currencyDecimals'] = 'Currency decimal places must be 0 or 2';
  }
  if (!payload.regionalSettings?.timezone || payload.regionalSettings.timezone.trim().length === 0) {
    errors['regionalSettings.timezone'] = 'Timezone is required';
  }

  // 4. Branch
  if (!payload.branch?.name || payload.branch.name.trim().length < 2) {
    errors['branch.name'] = 'Branch name is required (minimum 2 characters)';
  }
  if (!payload.branch?.code || payload.branch.code.trim().length < 2) {
    errors['branch.code'] = 'Branch code is required (e.g. HQ-01, BR-01)';
  }

  // 5. Counter
  if (!payload.counter?.name || payload.counter.name.trim().length < 2) {
    errors['counter.name'] = 'Counter / Terminal name is required';
  }
  if (!payload.counter?.code || payload.counter.code.trim().length < 2) {
    errors['counter.code'] = 'Counter code is required (e.g. REG-01, POS-01)';
  }

  // 6. Admin Account
  if (!payload.adminAccount?.fullName || payload.adminAccount.fullName.trim().length < 2) {
    errors['adminAccount.fullName'] = 'Administrator full name is required';
  }
  if (!payload.adminAccount?.username || !/^[a-zA-Z0-9_]{3,30}$/.test(payload.adminAccount.username)) {
    errors['adminAccount.username'] = 'Username must be 3-30 characters (letters, numbers, underscore only)';
  }
  if (!payload.adminAccount?.password || payload.adminAccount.password.length < 6) {
    errors['adminAccount.password'] = 'Password must be at least 6 characters long';
  }
  if (
    payload.adminAccount?.passwordConfirm !== undefined &&
    payload.adminAccount.password !== payload.adminAccount.passwordConfirm
  ) {
    errors['adminAccount.passwordConfirm'] = 'Password confirmation does not match password';
  }

  // 7. Receipt Settings
  if (!payload.receiptSettings?.displayName || payload.receiptSettings.displayName.trim().length < 2) {
    errors['receiptSettings.displayName'] = 'Receipt business display name is required';
  }
  if (!['58mm', '80mm', 'A4'].includes(payload.receiptSettings?.paperWidth)) {
    errors['receiptSettings.paperWidth'] = 'Paper width must be 58mm, 80mm, or A4';
  }

  // 8. Module Dependencies
  if (moduleCatalog.length > 0 && payload.modules?.enabledModuleCodes) {
    const depCheck = validateModuleDependencies(payload.modules.enabledModuleCodes, moduleCatalog);
    if (!depCheck.valid) {
      errors['modules.dependencies'] = depCheck.errors.join('; ');
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

export function assertValidOnboardingPayload(
  payload: OnboardingPayload,
  moduleCatalog: ModuleDefLike[] = []
): void {
  const result = validateOnboardingPayload(payload, moduleCatalog);
  if (!result.isValid) {
    const firstKey = Object.keys(result.errors)[0];
    throw new ValidationError(
      `Onboarding validation failed: ${result.errors[firstKey]}`,
      result.errors
    );
  }
}

