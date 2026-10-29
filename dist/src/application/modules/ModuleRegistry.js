"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultModuleRegistry = exports.ModuleRegistry = void 0;
const AppError_1 = require("../../shared/errors/AppError");
const default_modules_1 = require("./default-modules");
class ModuleRegistry {
    modules = new Map();
    constructor(preloadDefaults = true) {
        if (preloadDefaults) {
            this.loadDefaults();
        }
    }
    loadDefaults() {
        for (const mod of default_modules_1.CORE_MODULES) {
            this.modules.set(mod.code, mod);
        }
        for (const mod of default_modules_1.OPTIONAL_MODULES) {
            this.modules.set(mod.code, mod);
        }
    }
    /**
     * Registers a new or custom module contract.
     * Performs validation and circular dependency detection.
     */
    register(contract) {
        if (!contract.code || !contract.name) {
            throw new AppError_1.AppError('Module contract must have a valid code and name', 'VALIDATION_ERROR');
        }
        const previous = this.modules.get(contract.code);
        this.modules.set(contract.code, contract);
        const cycle = this.detectCycles();
        if (cycle) {
            // Rollback
            if (previous) {
                this.modules.set(contract.code, previous);
            }
            else {
                this.modules.delete(contract.code);
            }
            throw new AppError_1.AppError(`Circular dependency detected: ${cycle.join(' -> ')}`, 'CIRCULAR_DEPENDENCY');
        }
    }
    getModule(code) {
        return this.modules.get(code);
    }
    hasModule(code) {
        return this.modules.has(code);
    }
    getAllModules() {
        return Array.from(this.modules.values());
    }
    getCoreModules() {
        return this.getAllModules().filter(m => m.classification === 'CORE');
    }
    getOptionalModules() {
        return this.getAllModules().filter(m => m.classification === 'OPTIONAL');
    }
    /**
     * Performs Depth-First Search cycle detection on the registered module dependency graph.
     * Returns the cycle path as an array of codes (e.g. ['A', 'B', 'C', 'A']) or null if acyclic.
     */
    detectCycles() {
        const visited = new Set();
        const recStack = new Set();
        const path = [];
        const dfs = (node) => {
            visited.add(node);
            recStack.add(node);
            path.push(node);
            const mod = this.modules.get(node);
            if (mod && mod.dependencies) {
                for (const dep of mod.dependencies) {
                    if (!visited.has(dep)) {
                        const cycle = dfs(dep);
                        if (cycle)
                            return cycle;
                    }
                    else if (recStack.has(dep)) {
                        // Found cycle! Extract the cycle path
                        const cycleStartIndex = path.indexOf(dep);
                        return [...path.slice(cycleStartIndex), dep];
                    }
                }
            }
            path.pop();
            recStack.delete(node);
            return null;
        };
        for (const code of this.modules.keys()) {
            if (!visited.has(code)) {
                const cycle = dfs(code);
                if (cycle)
                    return cycle;
            }
        }
        return null;
    }
    /**
     * Validates whether a given set of module codes satisfies all prerequisite dependencies.
     */
    validateDependencies(enabledCodes) {
        const errors = [];
        const enabledSet = new Set(enabledCodes);
        // Legacy aliases for backward compatibility across migrations
        const aliases = {
            pos_checkout: 'sales',
            inventory_control: 'inventory_ledger',
            general_accounting: 'payments',
            customer_ledger: 'customer_credit',
            serial_warranty: 'serial_tracking',
            fefo_picking: 'fefo',
            variant_matrix: 'product_variants',
            bulk_pricing: 'wholesale_pricing'
        };
        for (const code of enabledCodes) {
            if (aliases[code]) {
                enabledSet.add(aliases[code]);
            }
        }
        // All core modules are automatically satisfied
        for (const mod of this.getCoreModules()) {
            enabledSet.add(mod.code);
        }
        for (const code of enabledCodes) {
            const canonicalCode = aliases[code] || code;
            const mod = this.modules.get(canonicalCode);
            if (!mod) {
                // External or unmanaged modules have no registry contract to validate
                continue;
            }
            for (const depCode of mod.dependencies) {
                if (!enabledSet.has(depCode)) {
                    const depMod = this.modules.get(depCode);
                    const depName = depMod ? depMod.name : depCode;
                    errors.push(`Module "${mod.name}" requires "${depName}" to be enabled.`);
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    /**
     * Validates if disabling a module is permitted or blocked by active dependents.
     */
    canDisable(codeToDisable, currentlyEnabledCodes) {
        const aliases = {
            pos_checkout: 'sales',
            inventory_control: 'inventory_ledger',
            general_accounting: 'payments',
            customer_ledger: 'customer_credit',
            serial_warranty: 'serial_tracking',
            fefo_picking: 'fefo',
            variant_matrix: 'product_variants',
            bulk_pricing: 'wholesale_pricing'
        };
        const canonicalToDisable = aliases[codeToDisable] || codeToDisable;
        const mod = this.modules.get(canonicalToDisable);
        if (!mod) {
            return { canDisable: false, blockedBy: [`Module "${codeToDisable}" not found.`] };
        }
        if (mod.classification === 'CORE') {
            return { canDisable: false, blockedBy: [`Core module "${mod.name}" cannot be disabled.`] };
        }
        const blockedBy = [];
        for (const rawCode of currentlyEnabledCodes) {
            const code = aliases[rawCode] || rawCode;
            if (code === canonicalToDisable)
                continue;
            const dependent = this.modules.get(code);
            if (dependent && dependent.dependencies.includes(canonicalToDisable)) {
                blockedBy.push(dependent.name);
            }
        }
        return {
            canDisable: blockedBy.length === 0,
            blockedBy
        };
    }
}
exports.ModuleRegistry = ModuleRegistry;
// Global default instance
exports.defaultModuleRegistry = new ModuleRegistry();
