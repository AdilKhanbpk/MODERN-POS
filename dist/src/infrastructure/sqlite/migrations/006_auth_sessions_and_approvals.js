"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV6 = applyMigrationV6;
const crypto_1 = __importDefault(require("crypto"));
function applyMigrationV6(db) {
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. ADD LOCKOUT COLUMNS TO USERS
        // -----------------------------------------------------------------------
        const userCols = db.prepare("PRAGMA table_info(users)").all();
        if (!userCols.some(c => c.name === 'failed_login_attempts')) {
            db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;');
        }
        if (!userCols.some(c => c.name === 'locked_until')) {
            db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT;');
        }
        // -----------------------------------------------------------------------
        // 2. USER_SESSIONS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token_hash TEXT NOT NULL,
        device_identifier TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_hash ON user_sessions(session_token_hash);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, revoked_at, expires_at);
    `);
        // -----------------------------------------------------------------------
        // 3. APPROVAL_REQUESTS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        request_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
        request_data TEXT, -- JSON
        original_value TEXT,
        proposed_value TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
        requested_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests(business_id, status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_branch ON approval_requests(branch_id);
    `);
        // -----------------------------------------------------------------------
        // 4. GRANULAR PERMISSIONS CATALOG
        // -----------------------------------------------------------------------
        const granularPermissions = [
            // Sales
            { code: 'sales.view', module: 'sales', desc: 'View sales invoices and order history' },
            { code: 'sales.create', module: 'sales', desc: 'Create cart and ring up sales items' },
            { code: 'sales.post', module: 'sales', desc: 'Tender payment and post authoritative sale invoices' },
            { code: 'sales.void', module: 'sales', desc: 'Cancel or void posted sale transactions' },
            { code: 'sales.discount.apply', module: 'sales', desc: 'Apply standard bill and line item discounts' },
            { code: 'sales.discount.override', module: 'sales', desc: 'Override maximum discount threshold' },
            { code: 'sales.price.override', module: 'sales', desc: 'Manually override unit sales price at register' },
            // Purchases
            { code: 'purchases.view', module: 'purchases', desc: 'View supplier purchase orders and bills' },
            { code: 'purchases.create', module: 'purchases', desc: 'Draft purchase orders' },
            { code: 'purchases.post', module: 'purchases', desc: 'Post purchase order and intake inventory' },
            { code: 'purchases.return', module: 'purchases', desc: 'Return defective or excess goods to supplier' },
            // Products Catalog
            { code: 'products.view', module: 'products', desc: 'View product catalog items and pricing' },
            { code: 'products.create', module: 'products', desc: 'Create new product catalog entries' },
            { code: 'products.edit', module: 'products', desc: 'Edit product names, barcodes, and prices' },
            { code: 'products.archive', module: 'products', desc: 'Archive or deactivate catalog products' },
            { code: 'products.change_cost', module: 'products', desc: 'Change product default cost and supplier rates' },
            // Inventory
            { code: 'inventory.view', module: 'inventory', desc: 'View physical inventory quantities and balances' },
            { code: 'inventory.adjust', module: 'inventory', desc: 'Perform physical stock audit count adjustments' },
            { code: 'inventory.transfer', module: 'inventory', desc: 'Transfer stock between store branches' },
            { code: 'inventory.view_cost', module: 'inventory', desc: 'View stock valuation and unit purchase cost' },
            // Customers
            { code: 'customers.view', module: 'customers', desc: 'View customer directory and contact information' },
            { code: 'customers.create', module: 'customers', desc: 'Create new customer accounts' },
            { code: 'customers.edit', module: 'customers', desc: 'Edit customer profile and credit limit' },
            { code: 'customers.view_balance', module: 'customers', desc: 'View customer khata / running credit balance' },
            { code: 'customers.manage_credit', module: 'customers', desc: 'Override customer credit limit' },
            // Suppliers
            { code: 'suppliers.view', module: 'suppliers', desc: 'View supplier directory and contact information' },
            { code: 'suppliers.create', module: 'suppliers', desc: 'Create new supplier vendor records' },
            { code: 'suppliers.edit', module: 'suppliers', desc: 'Edit supplier vendor profile' },
            { code: 'suppliers.view_balance', module: 'suppliers', desc: 'View supplier payable balance and bills' },
            // Payments
            { code: 'payments.receive', module: 'payments', desc: 'Receive payments from customers' },
            { code: 'payments.make', module: 'payments', desc: 'Disburse payments to suppliers or expense vendors' },
            { code: 'payments.reverse', module: 'payments', desc: 'Reverse or void previously recorded payments' },
            // Reports
            { code: 'reports.sales', module: 'reports', desc: 'View sales performance and Z-reports' },
            { code: 'reports.profit', module: 'reports', desc: 'View gross margin, net profit, and item margins' },
            { code: 'reports.inventory', module: 'reports', desc: 'View inventory stock valuation and movement ledger' },
            { code: 'reports.financial', module: 'reports', desc: 'View balance sheet, profit & loss, and trial balance' },
            // Administration & System
            { code: 'users.manage', module: 'system', desc: 'Create, edit, lock, and reset user passwords' },
            { code: 'roles.manage', module: 'system', desc: 'Configure role permissions and access rights' },
            { code: 'settings.manage', module: 'system', desc: 'Configure store settings, receipt headers, and currency' },
            { code: 'backups.manage', module: 'system', desc: 'Create and restore encrypted offline database backups' },
            { code: 'audit.view', module: 'audit', desc: 'View immutable system audit logs and login records' },
            // Approvals
            { code: 'approvals.request', module: 'approvals', desc: 'Submit supervisor approval requests' },
            { code: 'approvals.decide', module: 'approvals', desc: 'Approve or reject supervisor override requests' }
        ];
        const insertPerm = db.prepare(`
      INSERT INTO permissions (id, code, module, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        module = excluded.module,
        description = excluded.description
    `);
        for (const p of granularPermissions) {
            insertPerm.run(crypto_1.default.randomUUID(), p.code, p.module, p.desc);
        }
        // Also support legacy colon permissions for backwards compatibility
        const colonAliases = {
            'sales:create': 'sales.create',
            'sales:void': 'sales.void',
            'sales:discount': 'sales.discount.apply',
            'inventory:view': 'inventory.view',
            'inventory:adjust': 'inventory.adjust',
            'purchases:manage': 'purchases.post',
            'customers:manage': 'customers.edit',
            'reports:view': 'reports.sales',
            'settings:manage': 'settings.manage'
        };
        for (const [colonCode, dotCode] of Object.entries(colonAliases)) {
            const match = granularPermissions.find(p => p.code === dotCode);
            if (match) {
                insertPerm.run(crypto_1.default.randomUUID(), colonCode, match.module, match.desc);
            }
        }
        // -----------------------------------------------------------------------
        // 5. SEED 8 DEFAULT ROLES FOR BUSINESSES
        // -----------------------------------------------------------------------
        const businesses = db.prepare('SELECT id FROM businesses').all();
        const allPermRows = db.prepare('SELECT id, code FROM permissions').all();
        const permMap = new Map(allPermRows.map(p => [p.code, p.id]));
        const defaultRoleDefinitions = [
            {
                name: 'Owner',
                desc: 'Business proprietor with unrestricted access across all stores and modules',
                permissions: granularPermissions.map(p => p.code)
            },
            {
                name: 'Administrator',
                desc: 'System administrator with user management, settings, backup, and store privileges',
                permissions: granularPermissions.map(p => p.code)
            },
            {
                name: 'Manager',
                desc: 'Store manager with discount overrides, price overrides, approvals, inventory adjustments, and reports',
                permissions: [
                    'sales.view', 'sales.create', 'sales.post', 'sales.void', 'sales.discount.apply', 'sales.discount.override', 'sales.price.override',
                    'purchases.view', 'purchases.create', 'purchases.post', 'purchases.return',
                    'products.view', 'products.create', 'products.edit', 'products.archive', 'products.change_cost',
                    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.view_cost',
                    'customers.view', 'customers.create', 'customers.edit', 'customers.view_balance', 'customers.manage_credit',
                    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.view_balance',
                    'payments.receive', 'payments.make', 'payments.reverse',
                    'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'audit.view', 'approvals.request', 'approvals.decide'
                ]
            },
            {
                name: 'Cashier',
                desc: 'Checkout register operator: sales, receipt printing, customer lookup, and receiving customer cash',
                permissions: [
                    'sales.view', 'sales.create', 'sales.post', 'sales.discount.apply',
                    'products.view', 'customers.view', 'customers.create', 'payments.receive',
                    'approvals.request'
                ]
            },
            {
                name: 'Inventory Manager',
                desc: 'Warehouse clerk managing product catalog, stock intake, movements, and stock audits',
                permissions: [
                    'products.view', 'products.create', 'products.edit', 'products.archive',
                    'inventory.view', 'inventory.adjust', 'inventory.transfer',
                    'purchases.view', 'purchases.create', 'purchases.post',
                    'approvals.request'
                ]
            },
            {
                name: 'Purchase Manager',
                desc: 'Procurement manager handling vendor purchase bills, landed costs, and returns',
                permissions: [
                    'purchases.view', 'purchases.create', 'purchases.post', 'purchases.return',
                    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.view_balance',
                    'products.view', 'products.change_cost', 'inventory.view', 'inventory.view_cost',
                    'approvals.request'
                ]
            },
            {
                name: 'Accountant',
                desc: 'Financial controller overseeing double-entry ledgers, customer/supplier balances, payments, and financial P&L',
                permissions: [
                    'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'payments.receive', 'payments.make', 'payments.reverse',
                    'customers.view', 'customers.view_balance', 'suppliers.view', 'suppliers.view_balance',
                    'sales.view', 'purchases.view', 'inventory.view_cost', 'audit.view'
                ]
            },
            {
                name: 'Auditor',
                desc: 'Read-only compliance auditor inspecting audit trails, sales records, stock, and ledger books',
                permissions: [
                    'audit.view', 'reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial',
                    'sales.view', 'inventory.view', 'inventory.view_cost', 'purchases.view',
                    'customers.view', 'customers.view_balance', 'suppliers.view', 'suppliers.view_balance',
                    'products.view'
                ]
            }
        ];
        const insertRole = db.prepare(`
      INSERT INTO roles (id, business_id, name, description, is_system_role)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(business_id, name) DO UPDATE SET
        description = excluded.description,
        is_system_role = 1
    `);
        const insertRolePerm = db.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      VALUES (?, ?)
    `);
        for (const b of businesses) {
            for (const roleDef of defaultRoleDefinitions) {
                const roleId = crypto_1.default.randomUUID();
                insertRole.run(roleId, b.id, roleDef.name, roleDef.desc);
                // Fetch actual role ID (whether freshly inserted or existing)
                const actualRole = db.prepare('SELECT id FROM roles WHERE business_id = ? AND name = ?').get(b.id, roleDef.name);
                for (const code of roleDef.permissions) {
                    const permId = permMap.get(code);
                    if (permId) {
                        insertRolePerm.run(actualRole.id, permId);
                    }
                }
            }
        }
        // -----------------------------------------------------------------------
        // 6. RECORD MIGRATION 6
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(6, '006_auth_sessions_and_approvals');
    });
    tx();
}
