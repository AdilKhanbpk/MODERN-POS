"use strict";
/**
 * Domain: Universal Business Configuration
 * Defines configurable module feature flags supporting multiple retail sectors
 * (Grocery, Supermarket, Pharmacy, Clothing, Shoes, Cosmetics, Beverages, Electronics,
 *  Laboratory, Wholesale, General Retail, Other) within a single codebase.
 *
 * Rule: Disabling an optional module hides its UI controls and guards execution,
 * but NEVER alters, cascades, or damages existing historical database records.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessConfigManager = exports.BUSINESS_PROFILE_PRESETS = exports.BUSINESS_TYPES_METADATA = void 0;
exports.validateModuleDependencies = validateModuleDependencies;
exports.validateModuleDisable = validateModuleDisable;
exports.BUSINESS_TYPES_METADATA = [
    {
        type: 'GROCERY',
        label: 'Grocery / Karyana',
        description: 'Fresh vegetables, fruits, dry goods, loose items with hardware scale & expiry tracking',
        suggestedModules: ['weighing_scale', 'batch_expiry', 'customer_ledger']
    },
    {
        type: 'SUPERMARKET',
        label: 'Supermarket',
        description: 'Multi-counter retail with scale integration, perishable batch control & customer khata',
        suggestedModules: ['weighing_scale', 'batch_expiry', 'customer_ledger', 'supplier_payables', 'bulk_pricing']
    },
    {
        type: 'PHARMACY',
        label: 'Pharmacy',
        description: 'Medicine batches, strict expiry dates, automated FEFO picking & patient credit',
        suggestedModules: ['batch_expiry', 'fefo_picking', 'customer_ledger', 'supplier_payables']
    },
    {
        type: 'CLOTHING',
        label: 'Clothing',
        description: 'Garments, fabrics, and apparel organized by size, color, and style variants',
        suggestedModules: ['variant_matrix', 'customer_ledger']
    },
    {
        type: 'SHOES',
        label: 'Shoes',
        description: 'Footwear retail managed through multi-size, color, and fit variant matrix',
        suggestedModules: ['variant_matrix', 'customer_ledger']
    },
    {
        type: 'COSMETICS',
        label: 'Cosmetics',
        description: 'Beauty and skincare products with shade variants and batch expiry control',
        suggestedModules: ['batch_expiry', 'variant_matrix', 'customer_ledger']
    },
    {
        type: 'BEVERAGES',
        label: 'Beverages',
        description: 'Bottled drinks, crate packaging, bulk case pricing & batch expiry management',
        suggestedModules: ['batch_expiry', 'bulk_pricing', 'customer_ledger']
    },
    {
        type: 'ELECTRONICS',
        label: 'Electronics',
        description: 'Smartphones, computers, and appliances with IMEI/serial tracking and warranty claims',
        suggestedModules: ['serial_warranty', 'service_history', 'customer_ledger']
    },
    {
        type: 'LABORATORY',
        label: 'Laboratory Equipment',
        description: 'Scientific and lab instruments with serialized asset tracking and maintenance service history',
        suggestedModules: ['serial_warranty', 'service_history', 'batch_expiry', 'supplier_payables']
    },
    {
        type: 'WHOLESALE',
        label: 'Wholesale',
        description: 'Bulk volume sales, quantity tiered price breaks, supplier accounts and customer credit',
        suggestedModules: ['bulk_pricing', 'customer_ledger', 'supplier_payables']
    },
    {
        type: 'GENERAL_RETAIL',
        label: 'General Retail',
        description: 'Standard retail store with fast checkout, inventory control, and customer accounts',
        suggestedModules: ['customer_ledger', 'supplier_payables']
    },
    {
        type: 'OTHER',
        label: 'Other',
        description: 'Custom retail setup with selectable optional modules',
        suggestedModules: ['customer_ledger']
    }
];
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    SUPERMARKET: {
        enableWeighingScale: true,
        enableBatchTracking: true,
        enableExpiryTracking: true,
        enableFefoSelection: false,
        enableVariants: true,
        enableSerialTracking: false,
        enableWarrantyManagement: false,
        enableServiceHistory: false,
        enableMultiUnitConversions: true,
        enableCustomerCreditLedger: true,
        enablePrescriptionManagement: false,
        enableBulkPricing: true
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
        enablePrescriptionManagement: true,
        enableBulkPricing: false
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    CLOTHING: {
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    SHOES: {
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    COSMETICS: {
        enableWeighingScale: false,
        enableBatchTracking: true,
        enableExpiryTracking: true,
        enableFefoSelection: false,
        enableVariants: true,
        enableSerialTracking: false,
        enableWarrantyManagement: false,
        enableServiceHistory: false,
        enableMultiUnitConversions: true,
        enableCustomerCreditLedger: true,
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    BEVERAGES: {
        enableWeighingScale: false,
        enableBatchTracking: true,
        enableExpiryTracking: true,
        enableFefoSelection: false,
        enableVariants: false,
        enableSerialTracking: false,
        enableWarrantyManagement: false,
        enableServiceHistory: false,
        enableMultiUnitConversions: true,
        enableCustomerCreditLedger: true,
        enablePrescriptionManagement: false,
        enableBulkPricing: true
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    WHOLESALE: {
        enableWeighingScale: false,
        enableBatchTracking: false,
        enableExpiryTracking: false,
        enableFefoSelection: false,
        enableVariants: false,
        enableSerialTracking: false,
        enableWarrantyManagement: false,
        enableServiceHistory: false,
        enableMultiUnitConversions: true,
        enableCustomerCreditLedger: true,
        enablePrescriptionManagement: false,
        enableBulkPricing: true
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
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    },
    OTHER: {
        enableWeighingScale: false,
        enableBatchTracking: false,
        enableExpiryTracking: false,
        enableFefoSelection: false,
        enableVariants: false,
        enableSerialTracking: false,
        enableWarrantyManagement: false,
        enableServiceHistory: false,
        enableMultiUnitConversions: true,
        enableCustomerCreditLedger: true,
        enablePrescriptionManagement: false,
        enableBulkPricing: false
    }
};
/**
 * Validates that all dependencies for enabled modules are also enabled.
 */
function validateModuleDependencies(enabledCodes, catalog) {
    const errors = [];
    const enabledSet = new Set(enabledCodes);
    // All core modules in the catalog are permanently active and automatically satisfy dependencies
    for (const m of catalog) {
        if (m.isCore === true || m.is_core === 1 || m.is_core === true) {
            enabledSet.add(m.moduleCode);
        }
    }
    const catalogMap = new Map(catalog.map(m => [m.moduleCode, m]));
    for (const code of enabledCodes) {
        const def = catalogMap.get(code);
        if (def && def.dependencies && Array.isArray(def.dependencies)) {
            for (const depCode of def.dependencies) {
                if (!enabledSet.has(depCode)) {
                    const depDef = catalogMap.get(depCode);
                    const depName = depDef?.moduleName || depCode;
                    errors.push(`Module "${def.moduleName}" requires "${depName}" to be enabled.`);
                }
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
/**
 * Checks if disabling a module would break an active dependent module.
 */
function validateModuleDisable(codeToDisable, currentlyEnabledCodes, catalog) {
    const blockedBy = [];
    const currentlyEnabledSet = new Set(currentlyEnabledCodes);
    const catalogMap = new Map(catalog.map(m => [m.moduleCode, m]));
    for (const code of currentlyEnabledCodes) {
        if (code === codeToDisable)
            continue;
        const def = catalogMap.get(code);
        if (def && def.dependencies && def.dependencies.includes(codeToDisable)) {
            blockedBy.push(def.moduleName || def.moduleCode);
        }
    }
    return {
        canDisable: blockedBy.length === 0,
        blockedBy
    };
}
class BusinessConfigManager {
    static getPreset(type) {
        return { ...exports.BUSINESS_PROFILE_PRESETS[type] };
    }
    static resolveConfig(type, customOverrides = {}) {
        const base = this.getPreset(type);
        return {
            ...base,
            ...customOverrides
        };
    }
    static assertModuleEnabled(flags, moduleKey, actionDescription) {
        if (!flags[moduleKey]) {
            throw new Error(`Action rejected: "${actionDescription}" requires module "${moduleKey}" to be enabled. ` +
                `Current business configuration has disabled this module.`);
        }
    }
}
exports.BusinessConfigManager = BusinessConfigManager;
