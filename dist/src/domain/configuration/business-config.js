"use strict";
/**
 * Domain: Universal Business Configuration
 * Defines configurable module feature flags supporting multiple retail sectors
 * (Grocery, Pharmacy, Apparel, Electronics, Laboratory, General Retail) within a single codebase.
 *
 * Rule: Disabling an optional module hides its UI controls and guards execution,
 * but NEVER alters, cascades, or damages existing historical database records.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessConfigManager = exports.BUSINESS_PROFILE_PRESETS = void 0;
exports.BUSINESS_PROFILE_PRESETS = {
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
class BusinessConfigManager {
    /**
     * Returns default preset flags for a specific business vertical.
     */
    static getPreset(type) {
        return { ...exports.BUSINESS_PROFILE_PRESETS[type] };
    }
    /**
     * Merges custom user overrides with the base profile preset.
     */
    static resolveConfig(type, customOverrides = {}) {
        const base = this.getPreset(type);
        return {
            ...base,
            ...customOverrides
        };
    }
    /**
     * Asserts whether a required module is active. Throws an informative error if disabled.
     */
    static assertModuleEnabled(flags, moduleKey, actionDescription) {
        if (!flags[moduleKey]) {
            throw new Error(`Action rejected: "${actionDescription}" requires module "${moduleKey}" to be enabled. ` +
                `Current business configuration has disabled this module.`);
        }
    }
}
exports.BusinessConfigManager = BusinessConfigManager;
