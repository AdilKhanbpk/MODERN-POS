"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const connection_1 = require("../../infrastructure/sqlite/connection");
const onboarding_validator_1 = require("../../shared/validators/onboarding-validator");
const business_config_1 = require("../../domain/configuration/business-config");
const AppError_1 = require("../../shared/errors/AppError");
class OnboardingService {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Checks whether the application has completed initial onboarding.
     */
    isOnboardingCompleted() {
        const row = this.db
            .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'is_onboarding_completed'")
            .get();
        return row?.setting_value === 'true';
    }
    /**
     * Returns complete onboarding status including active business and draft info.
     */
    getStatus() {
        const isCompleted = this.isOnboardingCompleted();
        const bizRow = this.db
            .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'active_business_id'")
            .get();
        const activeBusinessId = bizRow?.setting_value;
        let businessName;
        if (activeBusinessId) {
            const b = this.db
                .prepare('SELECT name FROM businesses WHERE id = ?')
                .get(activeBusinessId);
            businessName = b?.name;
        }
        const draft = this.getDraft();
        return {
            isCompleted,
            activeBusinessId,
            businessName,
            hasDraft: !!draft,
            draftStep: draft?.currentStep
        };
    }
    /**
     * Saves an incomplete onboarding session draft to app_settings.
     */
    saveDraft(draft) {
        const serialized = JSON.stringify({
            currentStep: draft.currentStep,
            payload: draft.payload,
            savedAt: new Date().toISOString()
        });
        this.db
            .prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
         VALUES ('onboarding_draft', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           updated_at = excluded.updated_at`)
            .run(serialized);
    }
    /**
     * Retrieves any saved onboarding draft.
     */
    getDraft() {
        const row = this.db
            .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'onboarding_draft'")
            .get();
        if (!row?.setting_value)
            return null;
        try {
            return JSON.parse(row.setting_value);
        }
        catch {
            return null;
        }
    }
    /**
     * Clears saved draft.
     */
    clearDraft() {
        this.db.prepare("DELETE FROM app_settings WHERE setting_key = 'onboarding_draft'").run();
    }
    /**
     * Retrieves the catalog of modules with dependencies and enable statuses.
     */
    getModuleDefinitions(businessId) {
        const rows = this.db
            .prepare(`SELECT id, module_code, module_name, description, enables, is_core, dependencies
         FROM module_definitions
         ORDER BY is_core DESC, module_name ASC`)
            .all();
        let enabledMap = new Map();
        if (businessId) {
            const bizMods = this.db
                .prepare('SELECT module_id, is_enabled FROM business_modules WHERE business_id = ?')
                .all(businessId);
            for (const bm of bizMods) {
                enabledMap.set(bm.module_id, bm.is_enabled === 1);
            }
        }
        return rows.map(r => {
            let dependencies;
            if (r.dependencies) {
                try {
                    dependencies = JSON.parse(r.dependencies);
                }
                catch {
                    dependencies = [];
                }
            }
            return {
                id: r.id,
                moduleCode: r.module_code,
                moduleName: r.module_name,
                description: r.description,
                enables: r.enables,
                isCore: r.is_core === 1,
                dependencies,
                isEnabled: r.is_core === 1 || (businessId ? enabledMap.get(r.id) ?? false : false)
            };
        });
    }
    /**
     * Atomically executes the complete onboarding setup in a single database transaction.
     * If any step fails or violates constraints, all changes roll back 100%.
     */
    completeOnboarding(payload) {
        // 1. Fetch module definitions for validation
        const modulesCatalog = this.getModuleDefinitions().map(m => ({
            moduleCode: m.moduleCode,
            moduleName: m.moduleName,
            isCore: m.isCore,
            dependencies: m.dependencies
        }));
        // 2. Validate payload and module dependencies
        (0, onboarding_validator_1.assertValidOnboardingPayload)(payload, modulesCatalog);
        const businessId = crypto_1.default.randomUUID();
        const branchId = crypto_1.default.randomUUID();
        const counterId = crypto_1.default.randomUUID();
        const stockLocationId = crypto_1.default.randomUUID();
        const userId = crypto_1.default.randomUUID();
        const adminRoleId = crypto_1.default.randomUUID();
        const managerRoleId = crypto_1.default.randomUUID();
        const cashierRoleId = crypto_1.default.randomUUID();
        const clerkRoleId = crypto_1.default.randomUUID();
        // 3. Execute atomic transaction
        const transaction = this.db.transaction(() => {
            // 3.1 Check duplicate branch code within business
            const existingBranch = this.db
                .prepare('SELECT id FROM branches WHERE business_id = ? AND code = ?')
                .get(businessId, payload.branch.code);
            if (existingBranch) {
                throw new AppError_1.ConflictError(`Branch code "${payload.branch.code}" already exists in this business.`);
            }
            // 3.2 Insert Business
            this.db
                .prepare(`INSERT INTO businesses (
            id, name, legal_name, business_type, registration_number,
            phone, email, address, default_currency, timezone, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
                .run(businessId, payload.businessInfo.name.trim(), payload.businessInfo.legalName?.trim() || null, payload.businessType, payload.businessInfo.registrationNumber?.trim() || null, payload.businessInfo.phone.trim(), payload.businessInfo.email?.trim() || null, payload.businessInfo.address?.trim() || null, payload.regionalSettings.currencyCode.trim(), payload.regionalSettings.timezone.trim());
            // 3.3 Insert Default Branch
            this.db
                .prepare(`INSERT INTO branches (
            id, business_id, name, code, address, phone, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, 1)`)
                .run(branchId, businessId, payload.branch.name.trim(), payload.branch.code.trim().toUpperCase(), payload.branch.address?.trim() || payload.businessInfo.address?.trim() || null, payload.branch.phone?.trim() || payload.businessInfo.phone.trim());
            // 3.4 Insert Default Counter
            this.db
                .prepare(`INSERT INTO counters (
            id, business_id, branch_id, name, code, device_identifier, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, 1)`)
                .run(counterId, businessId, branchId, payload.counter.name.trim(), payload.counter.code.trim().toUpperCase(), payload.counter.deviceIdentifier?.trim() || 'TERM-01');
            // 3.5 Insert Admin User (bcrypt hashed password)
            const salt = bcryptjs_1.default.genSaltSync(10);
            const passwordHash = bcryptjs_1.default.hashSync(payload.adminAccount.password, salt);
            this.db
                .prepare(`INSERT INTO users (
            id, business_id, username, password_hash, full_name, email, phone, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
                .run(userId, businessId, payload.adminAccount.username.trim().toLowerCase(), passwordHash, payload.adminAccount.fullName.trim(), payload.adminAccount.email?.trim() || null, payload.adminAccount.phone?.trim() || null);
            // 3.5.1 Insert Default Stock Location (Prompt 11)
            this.db
                .prepare(`INSERT INTO stock_locations (
            id, business_id, branch_id, name, code, location_type,
            is_default, is_sellable, is_receivable, is_active, created_by
          ) VALUES (?, ?, ?, 'Main Store Floor', 'LOC-MAIN', 'shop_floor', 1, 1, 1, 1, ?)`)
                .run(stockLocationId, businessId, branchId, userId);
            // 3.5.2 Link Default Counter to Default Stock Location
            this.db
                .prepare(`INSERT INTO counter_stock_locations (
            id, business_id, counter_id, stock_location_id, is_default
          ) VALUES (?, ?, ?, ?, 1)`)
                .run(crypto_1.default.randomUUID(), businessId, counterId, stockLocationId);
            // 3.6 Insert Standard System Roles
            const insertRole = this.db.prepare(`INSERT INTO roles (id, business_id, name, description, is_system_role)
         VALUES (?, ?, ?, ?, 1)`);
            insertRole.run(adminRoleId, businessId, 'ADMIN', 'Store Administrator with full access');
            insertRole.run(crypto_1.default.randomUUID(), businessId, 'Owner', 'Business proprietor with unrestricted master authority');
            insertRole.run(crypto_1.default.randomUUID(), businessId, 'Administrator', 'System administrator with user and store configuration privileges');
            insertRole.run(managerRoleId, businessId, 'Manager', 'Store and shift manager');
            insertRole.run(cashierRoleId, businessId, 'Cashier', 'POS register and cash checkout cashier');
            insertRole.run(clerkRoleId, businessId, 'Inventory Manager', 'Inventory intake, movements, and audit adjustments');
            insertRole.run(crypto_1.default.randomUUID(), businessId, 'Purchase Manager', 'Supplier purchase orders, costs, and vendor returns');
            insertRole.run(crypto_1.default.randomUUID(), businessId, 'Accountant', 'General ledger, payments, financial P&L, and balance sheet');
            insertRole.run(crypto_1.default.randomUUID(), businessId, 'Auditor', 'Read-only compliance auditor across logs, stock, and ledger');
            // 3.7 Assign all permissions to ADMIN and Owner roles
            const allPermissions = this.db.prepare('SELECT id, code FROM permissions').all();
            const insertRolePerm = this.db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
            // Grant all permissions to ADMIN role
            for (const p of allPermissions) {
                insertRolePerm.run(adminRoleId, p.id);
            }
            // Assign role-specific granular permissions for standard roles
            const roleRows = this.db.prepare('SELECT id, name FROM roles WHERE business_id = ?').all(businessId);
            const roleMap = new Map(roleRows.map(r => [r.name, r.id]));
            const permMap = new Map(allPermissions.map(p => [p.code, p.id]));
            const rolePermMap = {
                Owner: allPermissions.map(p => p.code),
                Administrator: allPermissions.map(p => p.code),
                Manager: [
                    'sales.view', 'sales.create', 'sales.post', 'sales.void', 'sales.discount.apply', 'sales.discount.override', 'sales.price.override',
                    'purchases.view', 'purchases.create', 'purchases.post', 'purchases.return',
                    'products.view', 'products.create', 'products.edit', 'products.archive', 'products.change_cost',
                    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.view_cost',
                    'customers.view', 'customers.create', 'customers.edit', 'customers.view_balance', 'customers.manage_credit',
                    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.view_balance',
                    'payments.receive', 'payments.make', 'payments.reverse',
                    'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'audit.view', 'approvals.request', 'approvals.decide'
                ],
                Cashier: [
                    'sales.view', 'sales.create', 'sales.post', 'sales.discount.apply',
                    'products.view', 'customers.view', 'customers.create', 'payments.receive',
                    'approvals.request', 'sales:create', 'sales:discount'
                ],
                'Inventory Manager': [
                    'products.view', 'products.create', 'products.edit', 'products.archive',
                    'inventory.view', 'inventory.adjust', 'inventory.transfer',
                    'purchases.view', 'purchases.create', 'purchases.post', 'approvals.request'
                ],
                'Purchase Manager': [
                    'purchases.view', 'purchases.create', 'purchases.post', 'purchases.return',
                    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.view_balance',
                    'products.view', 'products.change_cost', 'inventory.view', 'inventory.view_cost',
                    'approvals.request'
                ],
                Accountant: [
                    'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'payments.receive', 'payments.make', 'payments.reverse',
                    'customers.view', 'customers.view_balance', 'suppliers.view', 'suppliers.view_balance',
                    'sales.view', 'purchases.view', 'inventory.view_cost', 'audit.view'
                ],
                Auditor: [
                    'audit.view', 'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'sales.view', 'inventory.view', 'inventory.view_cost', 'purchases.view',
                    'customers.view', 'customers.view_balance', 'suppliers.view', 'suppliers.view_balance',
                    'products.view'
                ]
            };
            for (const [rName, permCodes] of Object.entries(rolePermMap)) {
                const rId = roleMap.get(rName);
                if (rId) {
                    for (const c of permCodes) {
                        const pId = permMap.get(c);
                        if (pId) {
                            insertRolePerm.run(rId, pId);
                        }
                    }
                }
            }
            // 3.8 Assign ADMIN role to Owner User
            this.db
                .prepare('INSERT INTO user_roles (user_id, role_id, business_id) VALUES (?, ?, ?)')
                .run(userId, adminRoleId, businessId);
            // 3.9 Grant Branch Access to Admin User
            this.db
                .prepare('INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)')
                .run(userId, branchId);
            // 3.10 Save Module Selection to business_modules
            const allDefs = this.db
                .prepare('SELECT id, module_code, is_core FROM module_definitions')
                .all();
            const enabledSet = new Set(payload.modules.enabledModuleCodes);
            const insertBizMod = this.db.prepare(`INSERT INTO business_modules (
          id, business_id, module_id, is_enabled, configuration, enabled_at
        ) VALUES (?, ?, ?, ?, ?, ?)`);
            for (const d of allDefs) {
                const isCore = d.is_core === 1;
                const isEnabled = isCore || enabledSet.has(d.module_code);
                const config = payload.modules.moduleConfigs?.[d.module_code]
                    ? JSON.stringify(payload.modules.moduleConfigs[d.module_code])
                    : null;
                insertBizMod.run(crypto_1.default.randomUUID(), businessId, d.id, isEnabled ? 1 : 0, config, isEnabled ? new Date().toISOString() : null);
            }
            // 3.11 Save Receipt and Regional Settings in business_settings
            const insertBizSetting = this.db.prepare(`INSERT INTO business_settings (id, business_id, setting_key, setting_value, updated_by)
         VALUES (?, ?, ?, ?, ?)`);
            insertBizSetting.run(crypto_1.default.randomUUID(), businessId, 'receipt_settings', JSON.stringify(payload.receiptSettings), userId);
            insertBizSetting.run(crypto_1.default.randomUUID(), businessId, 'regional_settings', JSON.stringify(payload.regionalSettings), userId);
            // 3.12 Log Immutable Audit Event
            this.db
                .prepare(`INSERT INTO audit_logs (
            id, business_id, branch_id, user_id, action, entity_type, entity_id,
            reason, after_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(crypto_1.default.randomUUID(), businessId, branchId, userId, 'BUSINESS_ONBOARDING_COMPLETED', 'business', businessId, 'Initial business setup completed via onboarding wizard', JSON.stringify({
                businessName: payload.businessInfo.name,
                businessType: payload.businessType,
                currency: payload.regionalSettings.currencyCode,
                branchCode: payload.branch.code,
                counterCode: payload.counter.code,
                adminUsername: payload.adminAccount.username,
                enabledModules: payload.modules.enabledModuleCodes
            }));
            // 3.13 Seed Dedicated Walk-in Customer for new business
            this.db.prepare(`
        INSERT OR IGNORE INTO customers (
          id, business_id, customer_code, name, customer_type,
          credit_limit_minor, credit_days, opening_balance_minor,
          is_active, notes, balance, credit_limit
        )
        VALUES (?, ?, 'WALK-IN', 'Walk-in Customer', 'retail', 0, 0, 0, 1, 'Standard counter cash customer', 0, 0)
      `).run(crypto_1.default.randomUUID(), businessId);
            // 3.14 Mark Onboarding Complete and Set Active Business
            this.db
                .prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
           VALUES ('is_onboarding_completed', 'true', CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = 'true',
             updated_at = CURRENT_TIMESTAMP`)
                .run();
            this.db
                .prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
           VALUES ('active_business_id', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = excluded.setting_value,
             updated_at = CURRENT_TIMESTAMP`)
                .run(businessId);
            // 3.14 Clear Incomplete Draft
            this.db.prepare("DELETE FROM app_settings WHERE setting_key = 'onboarding_draft'").run();
        });
        transaction();
        return {
            businessId,
            branchId,
            counterId,
            stockLocationId,
            userId
        };
    }
    /**
     * Updates an optional module's enabled status post-onboarding with dependency safety.
     * Disabling never deletes tables or existing transaction rows.
     */
    updateModuleStatus(businessId, moduleCode, isEnabled, userId) {
        const modDef = this.db
            .prepare('SELECT id, module_code, module_name, is_core, dependencies FROM module_definitions WHERE module_code = ?')
            .get(moduleCode);
        if (!modDef) {
            throw new AppError_1.AppError(`Module with code "${moduleCode}" does not exist.`, 'NOT_FOUND');
        }
        if (modDef.is_core === 1 && !isEnabled) {
            throw new AppError_1.AppError(`Module "${modDef.module_name}" is a core module and cannot be disabled.`, 'BUSINESS_RULE_ERROR');
        }
        const allModules = this.getModuleDefinitions(businessId);
        const currentlyEnabledCodes = allModules.filter(m => m.isEnabled).map(m => m.moduleCode);
        if (isEnabled) {
            // Validate dependencies
            const depCheck = (0, business_config_1.validateModuleDependencies)([...currentlyEnabledCodes, moduleCode], allModules);
            if (!depCheck.valid) {
                throw new AppError_1.AppError(depCheck.errors.join('; '), 'BUSINESS_RULE_ERROR');
            }
        }
        else {
            // Validate that disabling won't break active dependent modules
            const disableCheck = (0, business_config_1.validateModuleDisable)(moduleCode, currentlyEnabledCodes, allModules);
            if (!disableCheck.canDisable) {
                throw new AppError_1.AppError(`Cannot disable "${modDef.module_name}" because active module(s) [${disableCheck.blockedBy.join(', ')}] depend on it.`, 'BUSINESS_RULE_ERROR');
            }
        }
        const existingBizMod = this.db
            .prepare('SELECT id FROM business_modules WHERE business_id = ? AND module_id = ?')
            .get(businessId, modDef.id);
        if (existingBizMod) {
            this.db
                .prepare(`UPDATE business_modules
           SET is_enabled = ?,
               ${isEnabled ? 'enabled_at = CURRENT_TIMESTAMP,' : 'disabled_at = CURRENT_TIMESTAMP,'}
               updated_by = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`)
                .run(isEnabled ? 1 : 0, userId || null, existingBizMod.id);
        }
        else {
            this.db
                .prepare(`INSERT INTO business_modules (
            id, business_id, module_id, is_enabled, enabled_at, updated_by
          ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`)
                .run(crypto_1.default.randomUUID(), businessId, modDef.id, isEnabled ? 1 : 0, userId || null);
        }
        // Write audit log
        this.db
            .prepare(`INSERT INTO audit_logs (
          id, business_id, user_id, action, entity_type, entity_id, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto_1.default.randomUUID(), businessId, userId || null, isEnabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED', 'business_module', modDef.id, `Module "${modDef.module_name}" was ${isEnabled ? 'enabled' : 'disabled'}`);
    }
}
exports.OnboardingService = OnboardingService;
