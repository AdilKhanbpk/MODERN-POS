/**
 * Domain: Universal Business Configuration
 * Defines configurable module feature flags supporting multiple retail sectors
 * (Grocery, Pharmacy, Apparel, Electronics, Laboratory, General Retail) within a single codebase.
 *
 * Rule: Disabling an optional module hides its UI controls and guards execution,
 * but NEVER alters, cascades, or damages existing historical database records.
 */

export type BusinessType =
  | 'GROCERY'
  | 'PHARMACY'
  | 'APPAREL'
  | 'ELECTRONICS'
  | 'LABORATORY'
  | 'GENERAL_RETAIL';

export interface BusinessModuleFlags {
  enableWeighingScale: boolean;
  enableBatchTracking: boolean;
  enableExpiryTracking: boolean;
  enableFefoSelection: boolean;
  enableVariants: boolean;
  enableSerialTracking: boolean;
  enableWarrantyManagement: boolean;
  enableServiceHistory: boolean;
  enableMultiUnitConversions: boolean;
  enableCustomerCreditLedger: boolean;
  enablePrescriptionManagement: boolean;
}

export const BUSINESS_PROFILE_PRESETS: Record<BusinessType, BusinessModuleFlags> = {
  GROCERY: {
    enableWeighingScale: true,
    enableBatchTracking: true,
    enableExpiryTracking: true,
    enableFefoSelection: false,
    enableVariants: false,
    enableSerialTracking: false,
    enableWarrantyManagement: false,
    enableServiceHistory: false,
    enableMultiUnitConversions: true,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: false
  },
  PHARMACY: {
    enableWeighingScale: false,
    enableBatchTracking: true,
    enableExpiryTracking: true,
    enableFefoSelection: true,
    enableVariants: false,
    enableSerialTracking: false,
    enableWarrantyManagement: false,
    enableServiceHistory: false,
    enableMultiUnitConversions: true,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: true
  },
  APPAREL: {
    enableWeighingScale: false,
    enableBatchTracking: false,
    enableExpiryTracking: false,
    enableFefoSelection: false,
    enableVariants: true,
    enableSerialTracking: false,
    enableWarrantyManagement: false,
    enableServiceHistory: false,
    enableMultiUnitConversions: true,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: false
  },
  ELECTRONICS: {
    enableWeighingScale: false,
    enableBatchTracking: false,
    enableExpiryTracking: false,
    enableFefoSelection: false,
    enableVariants: true,
    enableSerialTracking: true,
    enableWarrantyManagement: true,
    enableServiceHistory: true,
    enableMultiUnitConversions: false,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: false
  },
  LABORATORY: {
    enableWeighingScale: false,
    enableBatchTracking: true,
    enableExpiryTracking: false,
    enableFefoSelection: false,
    enableVariants: false,
    enableSerialTracking: true,
    enableWarrantyManagement: true,
    enableServiceHistory: true,
    enableMultiUnitConversions: false,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: false
  },
  GENERAL_RETAIL: {
    enableWeighingScale: false,
    enableBatchTracking: false,
    enableExpiryTracking: false,
    enableFefoSelection: false,
    enableVariants: true,
    enableSerialTracking: false,
    enableWarrantyManagement: false,
    enableServiceHistory: false,
    enableMultiUnitConversions: true,
    enableCustomerCreditLedger: true,
    enablePrescriptionManagement: false
  }
};

export class BusinessConfigManager {
  /**
   * Returns default preset flags for a specific business vertical.
   */
  public static getPreset(type: BusinessType): BusinessModuleFlags {
    return { ...BUSINESS_PROFILE_PRESETS[type] };
  }

  /**
   * Merges custom user overrides with the base profile preset.
   */
  public static resolveConfig(
    type: BusinessType,
    customOverrides: Partial<BusinessModuleFlags> = {}
  ): BusinessModuleFlags {
    const base = this.getPreset(type);
    return {
      ...base,
      ...customOverrides
    };
  }

  /**
   * Asserts whether a required module is active. Throws an informative error if disabled.
   */
  public static assertModuleEnabled(
    flags: BusinessModuleFlags,
    moduleKey: keyof BusinessModuleFlags,
    actionDescription: string
  ): void {
    if (!flags[moduleKey]) {
      throw new Error(
        `Action rejected: "${actionDescription}" requires module "${moduleKey}" to be enabled. ` +
        `Current business configuration has disabled this module.`
      );
    }
  }
}

