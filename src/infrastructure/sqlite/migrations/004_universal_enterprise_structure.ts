import Database from 'better-sqlite3';
import crypto from 'crypto';

export function applyMigrationV4(db: Database.Database): void {
  // Safe table restructuring requires temporarily toggling legacy alter and foreign keys
  db.pragma('legacy_alter_table = ON');
  db.pragma('foreign_keys = OFF');

  const tx = db.transaction(() => {
    // -----------------------------------------------------------------------
    // 1. BUSINESSES (Multi-Tenant Root)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        legal_name TEXT,
        business_type TEXT NOT NULL,
        registration_number TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        default_currency TEXT NOT NULL DEFAULT 'PKR',
        timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_businesses_active ON businesses(is_active);
    `);

    // Seed default business if not present
    const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, name, legal_name, business_type, default_currency, timezone, is_active)
      VALUES (?, 'Modern Retail POS Enterprise', 'Modern Retail POS (Pvt) Ltd', 'GENERAL_RETAIL', 'PKR', 'Asia/Karachi', 1)
    `).run(defaultBusinessId);

    // -----------------------------------------------------------------------
    // 2. BRANCHES (Business-Owned Store Locations)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, code),
        UNIQUE (id, business_id)
      );
      CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);
    `);

    // Seed default main branch
    const defaultBranchId = '00000000-0000-0000-0000-000000000002';
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, business_id, name, code, is_active)
      VALUES (?, ?, 'Headquarters Main Store', 'HQ-01', 1)
    `).run(defaultBranchId, defaultBusinessId);

    // -----------------------------------------------------------------------
    // 3. COUNTERS (Branch-Owned Cash Registers)
    // Cross-business validation enforced via composite foreign key (branch_id, business_id)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        device_identifier TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (branch_id, code),
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_counters_branch ON counters(branch_id);
    `);

    // Seed default counter
    const defaultCounterId = '00000000-0000-0000-0000-000000000003';
    db.prepare(`
      INSERT OR IGNORE INTO counters (id, business_id, branch_id, name, code, is_active)
      VALUES (?, ?, ?, 'Cash Counter 01', 'REG-01', 1)
    `).run(defaultCounterId, defaultBusinessId, defaultBranchId);

    // -----------------------------------------------------------------------
    // 4. USERS (UUID PK, Business-Owned)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_users (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, username),
        UNIQUE (id, business_id)
      );
      CREATE INDEX IF NOT EXISTS idx_users_business ON new_users(business_id);
    `);

    // Copy over any legacy users
    const hasUsersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (hasUsersTable) {
      db.prepare(`
        INSERT OR IGNORE INTO new_users (id, business_id, username, password_hash, full_name, is_active, created_at, updated_at)
        SELECT CAST(id AS TEXT), ?, username, password_hash, full_name, is_active, created_at, created_at
        FROM users
      `).run(defaultBusinessId);

      db.exec('DROP TABLE users;');
    }
    db.exec('ALTER TABLE new_users RENAME TO users;');

    // Seed default admin user UUID
    const defaultAdminId = '00000000-0000-0000-0000-000000000010';
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES (?, ?, 'admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrator', 1)
    `).run(defaultAdminId, defaultBusinessId);

    // Also support id '1' for backward compatibility with legacy integer references
    db.prepare(`
      INSERT OR IGNORE INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES ('1', ?, 'system_admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System Administrator', 1)
    `).run(defaultBusinessId);

    // -----------------------------------------------------------------------
    // 5. ROLES (UUID PK, Business-Owned)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_roles (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        description TEXT,
        is_system_role INTEGER NOT NULL DEFAULT 0 CHECK(is_system_role IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, name),
        UNIQUE (id, business_id)
      );
      CREATE INDEX IF NOT EXISTS idx_roles_business ON new_roles(business_id);
    `);

    const hasRolesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'").get();
    if (hasRolesTable) {
      db.prepare(`
        INSERT OR IGNORE INTO new_roles (id, business_id, name, description, is_system_role)
        SELECT CAST(id AS TEXT), ?, name, description, 0
        FROM roles
      `).run(defaultBusinessId);
      db.exec('DROP TABLE roles;');
    }
    db.exec('ALTER TABLE new_roles RENAME TO roles;');

    // Seed standard enterprise system roles
    const standardRoles = [
      { id: '00000000-0000-0000-0000-000000000020', name: 'ADMIN', desc: 'Full administrative access', sys: 1 },
      { id: '00000000-0000-0000-0000-000000000021', name: 'MANAGER', desc: 'Store and shift management', sys: 1 },
      { id: '00000000-0000-0000-0000-000000000022', name: 'CASHIER', desc: 'POS checkout and daily register operations', sys: 1 },
      { id: '00000000-0000-0000-0000-000000000023', name: 'INVENTORY_CLERK', desc: 'Stock movements, batches and counts', sys: 1 }
    ];
    const insertRole = db.prepare(`
      INSERT OR IGNORE INTO roles (id, business_id, name, description, is_system_role)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of standardRoles) {
      insertRole.run(r.id, defaultBusinessId, r.name, r.desc, r.sys);
    }

    // -----------------------------------------------------------------------
    // 6. PERMISSIONS (UUID PK, Universal Catalog)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_permissions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        module TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);

    const hasPermTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'").get();
    if (hasPermTable) {
      db.exec('DROP TABLE permissions;');
    }
    db.exec('ALTER TABLE new_permissions RENAME TO permissions;');

    const systemPermissions = [
      { id: '00000000-0000-0000-0000-000000000030', code: 'sales:create', module: 'sales', desc: 'Create and tender sales' },
      { id: '00000000-0000-0000-0000-000000000031', code: 'sales:void', module: 'sales', desc: 'Void posted sales' },
      { id: '00000000-0000-0000-0000-000000000032', code: 'sales:discount', module: 'sales', desc: 'Apply bill and item discounts' },
      { id: '00000000-0000-0000-0000-000000000033', code: 'inventory:view', module: 'inventory', desc: 'View inventory stock balances' },
      { id: '00000000-0000-0000-0000-000000000034', code: 'inventory:adjust', module: 'inventory', desc: 'Execute stock audit adjustments' },
      { id: '00000000-0000-0000-0000-000000000035', code: 'purchases:manage', module: 'purchases', desc: 'Receive goods and post bills' },
      { id: '00000000-0000-0000-0000-000000000036', code: 'customers:manage', module: 'customers', desc: 'Manage customers and credit limits' },
      { id: '00000000-0000-0000-0000-000000000037', code: 'reports:view', module: 'reports', desc: 'View financial statements and Z-Reports' },
      { id: '00000000-0000-0000-0000-000000000038', code: 'settings:manage', module: 'settings', desc: 'Manage store settings and configurations' }
    ];
    const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (id, code, module, description) VALUES (?, ?, ?, ?)');
    for (const p of systemPermissions) {
      insertPerm.run(p.id, p.code, p.module, p.desc);
    }

    // -----------------------------------------------------------------------
    // 7. ROLE_PERMISSIONS
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_role_permissions (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
    `);
    const hasRolePermTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='role_permissions'").get();
    if (hasRolePermTable) {
      db.exec('DROP TABLE role_permissions;');
    }
    db.exec('ALTER TABLE new_role_permissions RENAME TO role_permissions;');

    // Grant all permissions to Admin role
    const adminRoleId = '00000000-0000-0000-0000-000000000020';
    const insertRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
    for (const p of systemPermissions) {
      insertRolePerm.run(adminRoleId, p.id);
    }

    // -----------------------------------------------------------------------
    // 8. USER_ROLES (Cross-Business Isolation Enforced)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id, business_id) REFERENCES users(id, business_id) ON DELETE CASCADE,
        FOREIGN KEY (role_id, business_id) REFERENCES roles(id, business_id) ON DELETE RESTRICT
      );
    `);
    const hasUserRolesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'").get();
    if (hasUserRolesTable) {
      db.exec('DROP TABLE user_roles;');
    }
    db.exec('ALTER TABLE new_user_roles RENAME TO user_roles;');

    // Assign Admin role to default admin user
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, business_id) VALUES (?, ?, ?)').run(
      defaultAdminId,
      adminRoleId,
      defaultBusinessId
    );

    // -----------------------------------------------------------------------
    // 9. USER_BRANCH_ACCESS
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_branch_access (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, branch_id)
      );
    `);

    db.prepare('INSERT OR IGNORE INTO user_branch_access (user_id, branch_id) VALUES (?, ?)').run(
      defaultAdminId,
      defaultBranchId
    );

    // -----------------------------------------------------------------------
    // 10. BUSINESS_SETTINGS (UUID PK, JSON value, scoped per business)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_business_settings (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL, -- JSON formatted
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, setting_key)
      );
      CREATE INDEX IF NOT EXISTS idx_biz_settings ON new_business_settings(business_id, setting_key);
    `);

    const hasBizSettings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_settings'").get();
    if (hasBizSettings) {
      db.exec('DROP TABLE business_settings;');
    }
    db.exec('ALTER TABLE new_business_settings RENAME TO business_settings;');

    // -----------------------------------------------------------------------
    // 11. MODULE_DEFINITIONS
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS module_definitions (
        id TEXT PRIMARY KEY,
        module_code TEXT UNIQUE NOT NULL,
        module_name TEXT NOT NULL,
        description TEXT,
        is_core INTEGER NOT NULL DEFAULT 0 CHECK(is_core IN (0, 1)),
        dependencies TEXT, -- JSON array of module_codes
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
    `);

    const moduleCatalog = [
      { id: '00000000-0000-0000-0000-000000000040', code: 'pos_checkout', name: 'POS Checkout & Terminal', core: 1, desc: 'Sales, cashier registers and receipt printing' },
      { id: '00000000-0000-0000-0000-000000000041', code: 'inventory_control', name: 'Inventory & Stock Ledger', core: 1, desc: 'Stock movements, balances, adjustments' },
      { id: '00000000-0000-0000-0000-000000000042', code: 'customer_ledger', name: 'Customer Credit & Statement', core: 1, desc: 'Customer receivables, ledgers and credit limits' },
      { id: '00000000-0000-0000-0000-000000000043', code: 'supplier_payables', name: 'Supplier Purchases & AP', core: 1, desc: 'Landed cost purchases, supplier ledger and returns' },
      { id: '00000000-0000-0000-0000-000000000044', code: 'general_accounting', name: 'Double-Entry Accounting', core: 1, desc: 'Chart of accounts and general journal' },
      { id: '00000000-0000-0000-0000-000000000045', code: 'weighing_scale', name: 'Weighing Scale Integration', core: 0, desc: 'Electronic hardware scale serial/USB streaming' },
      { id: '00000000-0000-0000-0000-000000000046', code: 'batch_expiry', name: 'Batch & Expiry Tracking (FEFO)', core: 0, desc: 'Pharmaceutical and food batch expiry control' },
      { id: '00000000-0000-0000-0000-000000000047', code: 'variant_matrix', name: 'Apparel Variant Matrix', core: 0, desc: 'Size, color and style variant management' },
      { id: '00000000-0000-0000-0000-000000000048', code: 'serial_warranty', name: 'Serial Number & Warranty', core: 0, desc: 'Electronics IMEI/serial tracking and repair claims' },
      { id: '00000000-0000-0000-0000-000000000049', code: 'branch_sync', name: 'Branch PostgreSQL Sync', core: 0, desc: 'Central PostgreSQL synchronization engine' }
    ];
    const insertModDef = db.prepare('INSERT OR IGNORE INTO module_definitions (id, module_code, module_name, description, is_core) VALUES (?, ?, ?, ?, ?)');
    for (const m of moduleCatalog) {
      insertModDef.run(m.id, m.code, m.name, m.desc, m.core);
    }

    // -----------------------------------------------------------------------
    // 12. BUSINESS_MODULES
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS business_modules (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        module_id TEXT NOT NULL REFERENCES module_definitions(id) ON DELETE RESTRICT,
        is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0, 1)),
        configuration TEXT, -- JSON
        enabled_at TEXT,
        disabled_at TEXT,
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, module_id)
      );
      CREATE INDEX IF NOT EXISTS idx_biz_modules ON business_modules(business_id, module_id);
    `);

    // Enable core modules for default business
    const insertBizMod = db.prepare(`
      INSERT OR IGNORE INTO business_modules (id, business_id, module_id, is_enabled, enabled_at)
      VALUES (?, ?, ?, 1, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    `);
    for (const m of moduleCatalog.filter(mod => mod.core === 1)) {
      insertBizMod.run(crypto.randomUUID(), defaultBusinessId, m.id);
    }

    // -----------------------------------------------------------------------
    // 13. AUDIT_LOGS (Append-Only with Triggers)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_audit_logs (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_data TEXT, -- JSON
        after_data TEXT,  -- JSON
        reason TEXT,
        ip_address TEXT,
        device_identifier TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_biz ON new_audit_logs(business_id);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON new_audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON new_audit_logs(created_at);

      -- Append-only security triggers: prohibit DELETE and UPDATE
      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
      BEFORE DELETE ON new_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log records are append-only and cannot be deleted.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
      BEFORE UPDATE ON new_audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log records are immutable and cannot be updated.');
      END;
    `);

    const hasAuditTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
    if (hasAuditTable) {
      db.exec('DROP TABLE audit_logs;');
    }
    db.exec('ALTER TABLE new_audit_logs RENAME TO audit_logs;');

    // -----------------------------------------------------------------------
    // 14. RECORD MIGRATION 4
    // -----------------------------------------------------------------------
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      4,
      '004_universal_enterprise_structure'
    );
  });

  try {
    tx();
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

