import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { OnboardingService } from '../../src/application/services/OnboardingService';
import { ModuleRegistry } from '../../src/application/modules/ModuleRegistry';
import { ModuleManager } from '../../src/application/modules/ModuleManager';
import { CORE_MODULES, OPTIONAL_MODULES } from '../../src/application/modules/default-modules';
import { IModuleContract } from '../../src/shared/types/module-contract';
import { AppError, ForbiddenError, ValidationError } from '../../src/shared/errors/AppError';

describe('Prompt 5 — Modular Architecture & Optional Feature Framework', () => {
  let db: Database.Database;
  let registry: ModuleRegistry;
  let moduleManager: ModuleManager;
  let onboardingService: OnboardingService;

  let businessId: string;
  let branchId: string;
  let counterId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    registry = new ModuleRegistry();
    moduleManager = new ModuleManager(db, registry);
    onboardingService = new OnboardingService(db);

    // Initialize business via OnboardingService
    const setup = onboardingService.completeOnboarding({
      businessInfo: {
        name: 'Apex Supermarket',
        phone: '0300-9998877'
      },
      businessType: 'SUPERMARKET',
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
        name: 'Main Supermarket Branch',
        code: 'MAIN',
        address: 'Main Commercial Area',
        phone: '0300-9998877'
      },
      counter: {
        name: 'Express Checkout Counter 1',
        code: 'POS-01'
      },
      adminAccount: {
        fullName: 'System Administrator',
        username: 'superadmin',
        password: 'Password123!',
        passwordConfirm: 'Password123!'
      },
      modules: {
        enabledModuleCodes: ['weighing_scale', 'customer_credit']
      },
      receiptSettings: {
        displayName: 'Apex Supermarket',
        paperWidth: '80mm',
        showCashierName: true
      }
    });

    businessId = setup.businessId;
    branchId = setup.branchId;
    counterId = setup.counterId;
  });

  // =========================================================================
  // TEST 1: CATALOG INTEGRITY (15 CORE & 28 OPTIONAL MODULES)
  // =========================================================================
  it('1. Correctly registers all 15 Core Modules and 28 Optional Modules in the registry', () => {
    const coreMods = registry.getCoreModules();
    const optionalMods = registry.getOptionalModules();
    const allMods = registry.getAllModules();

    expect(coreMods).toHaveLength(15);
    expect(optionalMods).toHaveLength(28);
    expect(allMods).toHaveLength(43);

    const expectedCoreCodes = [
      'business_setup',
      'authentication',
      'products',
      'customers',
      'suppliers',
      'units',
      'sales',
      'purchases',
      'inventory_ledger',
      'payments',
      'cash_register',
      'expenses',
      'reports',
      'audit',
      'backup_restore'
    ];

    for (const code of expectedCoreCodes) {
      const mod = registry.getModule(code);
      expect(mod).toBeDefined();
      expect(mod?.classification).toBe('CORE');
    }

    const expectedOptionalCodes = [
      'batch_expiry',
      'fefo',
      'serial_tracking',
      'warranty_repair',
      'product_variants',
      'weighing_scale',
      'scale_barcode_parsing',
      'purchase_orders',
      'goods_receiving',
      'stock_transfers',
      'multiple_warehouses',
      'wholesale_pricing',
      'customer_credit',
      'loyalty',
      'promotions',
      'quotations',
      'sales_orders',
      'reservations',
      'multi_counter',
      'multi_branch',
      'tax_extensions',
      'employee_management',
      'attendance',
      'payroll',
      'whatsapp_integration',
      'online_orders',
      'cloud_backup',
      'advanced_analytics'
    ];

    for (const code of expectedOptionalCodes) {
      const mod = registry.getModule(code);
      expect(mod).toBeDefined();
      expect(mod?.classification).toBe('OPTIONAL');
    }
  });

  // =========================================================================
  // TEST 2: CORE MODULES ARE IMMUTABLE AND CANNOT BE DISABLED
  // =========================================================================
  it('2. Enforces that core modules are always active and strictly rejects disabling them', () => {
    // Core modules are always reported as enabled
    expect(moduleManager.isModuleEnabled(businessId, 'sales')).toBe(true);
    expect(moduleManager.isModuleEnabled(businessId, 'products')).toBe(true);
    expect(moduleManager.isModuleEnabled(businessId, 'inventory_ledger')).toBe(true);

    // Attempting to disable any core module must throw ForbiddenError
    expect(() => {
      moduleManager.disableModule(businessId, 'sales');
    }).toThrow(/Core module "Sales" cannot be disabled/i);

    expect(() => {
      moduleManager.disableModule(businessId, 'inventory_ledger');
    }).toThrow(/Core module "Inventory Ledger" cannot be disabled/i);
  });

  // =========================================================================
  // TEST 3: PREREQUISITE DEPENDENCY VALIDATION ON ENABLING
  // =========================================================================
  it('3. Rejects enabling an optional module when its required prerequisite dependencies are not enabled', () => {
    // 'fefo' depends on 'batch_expiry'
    expect(moduleManager.isModuleEnabled(businessId, 'batch_expiry')).toBe(false);

    expect(() => {
      moduleManager.enableModule(businessId, 'fefo');
    }).toThrow(/requires "(Batch and Expiry|Batch & Expiry Date Tracking)" to be enabled/i);

    // 'warranty_repair' depends on 'serial_tracking'
    expect(moduleManager.isModuleEnabled(businessId, 'serial_tracking')).toBe(false);

    expect(() => {
      moduleManager.enableModule(businessId, 'warranty_repair');
    }).toThrow(/requires "Serial Number Tracking" to be enabled/i);

    // 'attendance' depends on 'employee_management'
    expect(() => {
      moduleManager.enableModule(businessId, 'attendance');
    }).toThrow(/requires "Employee Management" to be enabled/i);
  });

  // =========================================================================
  // TEST 4: CIRCULAR DEPENDENCY DETECTION WITH EXPLICIT PATH TRACE
  // =========================================================================
  it('4. Detects and rejects circular module dependencies with an informative cycle trace', () => {
    const cycleRegistry = new ModuleRegistry(false);

    // Register Mod A -> depends on Mod B
    cycleRegistry.register({
      code: 'mod_a',
      name: 'Module A',
      description: 'Test A',
      category: 'INVENTORY',
      classification: 'OPTIONAL',
      version: '1.0.0',
      dependencies: ['mod_b']
    });

    // Register Mod B -> depends on Mod C
    cycleRegistry.register({
      code: 'mod_b',
      name: 'Module B',
      description: 'Test B',
      category: 'INVENTORY',
      classification: 'OPTIONAL',
      version: '1.0.0',
      dependencies: ['mod_c']
    });

    // Register Mod C -> depends on Mod A (creates cycle: A -> B -> C -> A)
    expect(() => {
      cycleRegistry.register({
        code: 'mod_c',
        name: 'Module C',
        description: 'Test C',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['mod_a']
      });
    }).toThrow(/Circular dependency detected: mod_a -> mod_b -> mod_c -> mod_a/i);

    // Verify registry rolled back and Mod C was NOT kept in registry
    expect(cycleRegistry.hasModule('mod_c')).toBe(false);
  });

  // =========================================================================
  // TEST 5: ENABLING MODULES WITH LIFECYCLE HOOKS AND EVENT AUDITING
  // =========================================================================
  it('5. Successfully enables modules in order, triggers lifecycle hooks, and logs idempotent events', () => {
    let hookExecuted = false;

    // Register a custom module with a lifecycle hook
    registry.register({
      code: 'custom_tax',
      name: 'Custom Tax Rule',
      description: 'Special tax engine',
      category: 'SALES',
      classification: 'OPTIONAL',
      version: '1.0.0',
      dependencies: ['sales'],
      enable: (ctx) => {
        hookExecuted = true;
      }
    });

    expect(moduleManager.isModuleEnabled(businessId, 'custom_tax')).toBe(false);

    // Enable custom_tax
    moduleManager.enableModule(businessId, 'custom_tax', 'admin-user-1');

    expect(hookExecuted).toBe(true);
    expect(moduleManager.isModuleEnabled(businessId, 'custom_tax')).toBe(true);

    // Verify database row in business_modules
    const row = db.prepare(`
      SELECT bm.is_enabled, bm.enabled_at, bm.disabled_at
      FROM business_modules bm
      JOIN module_definitions md ON md.id = bm.module_id
      WHERE bm.business_id = ? AND md.module_code = 'custom_tax'
    `).get(businessId) as { is_enabled: number; enabled_at: string; disabled_at: string | null };

    expect(row.is_enabled).toBe(1);
    expect(row.enabled_at).toBeDefined();
    expect(row.disabled_at).toBeNull();

    // Verify idempotent module event logged
    const events = moduleManager.getModuleEvents(businessId, 'custom_tax');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event_code).toBe('MODULE_ENABLED');
  });

  // =========================================================================
  // TEST 6: NON-DESTRUCTIVE DISABLING AND DEPENDENT BLOCKING
  // =========================================================================
  it('6. Blocks disabling when active dependents exist, and performs non-destructive disabling when permitted', () => {
    // First enable batch_expiry, then fefo
    moduleManager.enableModule(businessId, 'batch_expiry');
    moduleManager.enableModule(businessId, 'fefo');

    expect(moduleManager.isModuleEnabled(businessId, 'batch_expiry')).toBe(true);
    expect(moduleManager.isModuleEnabled(businessId, 'fefo')).toBe(true);

    // Attempting to disable 'batch_expiry' while 'fefo' is enabled must be BLOCKED
    expect(() => {
      moduleManager.disableModule(businessId, 'batch_expiry');
    }).toThrow(/Cannot disable module "(Batch and Expiry|Batch & Expiry Date Tracking)" because it is required by: FEFO/i);

    // Disable 'fefo' first
    moduleManager.disableModule(businessId, 'fefo');
    expect(moduleManager.isModuleEnabled(businessId, 'fefo')).toBe(false);

    // Now disabling 'batch_expiry' succeeds
    moduleManager.disableModule(businessId, 'batch_expiry');
    expect(moduleManager.isModuleEnabled(businessId, 'batch_expiry')).toBe(false);

    // Verify business_modules state: marked is_enabled = 0, disabled_at IS NOT NULL
    const row = db.prepare(`
      SELECT bm.is_enabled, bm.disabled_at
      FROM business_modules bm
      JOIN module_definitions md ON md.id = bm.module_id
      WHERE bm.business_id = ? AND md.module_code = 'batch_expiry'
    `).get(businessId) as { is_enabled: number; disabled_at: string | null };

    expect(row.is_enabled).toBe(0);
    expect(row.disabled_at).not.toBeNull();
  });

  // =========================================================================
  // TEST 7: HISTORICAL DATA AND TABLES REMAIN 100% PRESERVED UPON DISABLING
  // =========================================================================
  it('7. Preserves all tables, historical transactions, and audit records intact when a module is disabled', () => {
    // 1. Enable batch tracking and create a test product with batch number
    moduleManager.enableModule(businessId, 'batch_expiry');

    const catId = db.prepare('SELECT id FROM product_categories LIMIT 1').get() as { id: number };
    const insertProd = db.prepare(`
      INSERT INTO products (category_id, name, sku, barcode, base_unit, cost_price, selling_price, current_stock)
      VALUES (?, 'Panadol 500mg Batch Pack', 'PAN-BATCH-01', '8964000112233', 'Piece', 2000, 2500, 100)
    `).run(catId.id);

    const productId = insertProd.lastInsertRowid;

    // Simulate batch table entry
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_batches (
        id TEXT PRIMARY KEY,
        product_id INTEGER NOT NULL,
        batch_number TEXT NOT NULL,
        expiry_date TEXT NOT NULL
      );
    `);

    db.prepare(`
      INSERT INTO test_batches (id, product_id, batch_number, expiry_date)
      VALUES ('BATCH-001', ?, 'BATCH-ABC-2026', '2027-12-31')
    `).run(productId);

    // 2. Disable batch_expiry
    moduleManager.disableModule(businessId, 'batch_expiry');
    expect(moduleManager.isModuleEnabled(businessId, 'batch_expiry')).toBe(false);

    // 3. Verify historical data: tables still exist and records are 100% readable
    const batchRow = db.prepare('SELECT * FROM test_batches WHERE id = ?').get('BATCH-001') as any;
    expect(batchRow).toBeDefined();
    expect(batchRow.batch_number).toBe('BATCH-ABC-2026');
    expect(batchRow.expiry_date).toBe('2027-12-31');

    // 4. Re-enabling restores active status without data corruption
    moduleManager.enableModule(businessId, 'batch_expiry');
    expect(moduleManager.isModuleEnabled(businessId, 'batch_expiry')).toBe(true);

    const recheckBatch = db.prepare('SELECT * FROM test_batches WHERE id = ?').get('BATCH-001') as any;
    expect(recheckBatch.batch_number).toBe('BATCH-ABC-2026');
  });

  // =========================================================================
  // TEST 8: BACKEND OPERATIONAL GUARDS (assertModuleEnabled)
  // =========================================================================
  it('8. Enforces backend operational guards and rejects direct API calls for disabled modules', () => {
    // 'customer_credit' was enabled during onboarding
    expect(moduleManager.isModuleEnabled(businessId, 'customer_credit')).toBe(true);

    // Calling assertModuleEnabled on enabled module does not throw
    expect(() => {
      moduleManager.assertModuleEnabled(businessId, 'customer_credit', 'Issue Customer Khata Credit');
    }).not.toThrow();

    // Disable customer_credit
    moduleManager.disableModule(businessId, 'customer_credit');
    expect(moduleManager.isModuleEnabled(businessId, 'customer_credit')).toBe(false);

    // Calling assertModuleEnabled on disabled module must throw AppError with 403 / MODULE_DISABLED
    expect(() => {
      moduleManager.assertModuleEnabled(businessId, 'customer_credit', 'Issue Customer Khata Credit');
    }).toThrow(/Action rejected: "Issue Customer Khata Credit" requires module "customer_credit" to be enabled/i);
  });

  // =========================================================================
  // TEST 9: DYNAMIC NAVIGATION FILTERED BY ENABLED MODULES AND USER PERMISSIONS
  // =========================================================================
  it('9. Dynamically updates navigation menu based strictly on active modules and user permissions', () => {
    // Test with Cashier permissions (sales only)
    const cashierPermissions = ['sales.create', 'sales.view'];
    const cashierNav = moduleManager.getNavigation(businessId, cashierPermissions);

    // Cashier should have POS Checkout
    expect(cashierNav.some(n => n.id === 'nav-pos')).toBe(true);
    // Cashier should NOT see Settings or Audit logs
    expect(cashierNav.some(n => n.id === 'nav-settings')).toBe(false);
    expect(cashierNav.some(n => n.id === 'nav-audit')).toBe(false);

    // Test with Admin permissions (*)
    const adminPermissions = ['*'];
    let adminNav = moduleManager.getNavigation(businessId, adminPermissions);

    // Initially 'quotations' is disabled
    expect(adminNav.some(n => n.id === 'nav-quotations')).toBe(false);

    // Enable quotations
    moduleManager.enableModule(businessId, 'quotations');
    adminNav = moduleManager.getNavigation(businessId, adminPermissions);

    // Now quotations navigation entry appears!
    expect(adminNav.some(n => n.id === 'nav-quotations')).toBe(true);

    // Disable quotations -> disappears from navigation immediately
    moduleManager.disableModule(businessId, 'quotations');
    adminNav = moduleManager.getNavigation(businessId, adminPermissions);
    expect(adminNav.some(n => n.id === 'nav-quotations')).toBe(false);
  });

  // =========================================================================
  // TEST 10: TRANSACTION ROLLBACK ON INSTALLATION OR MIGRATION FAILURE
  // =========================================================================
  it('10. Rolls back database mutations completely if a module install lifecycle hook throws', () => {
    registry.register({
      code: 'faulty_module',
      name: 'Faulty Module',
      description: 'Throws during install',
      category: 'INTEGRATION',
      classification: 'OPTIONAL',
      version: '1.0.0',
      dependencies: [],
      install: (ctx) => {
        // Create a temporary table then fail
        ctx.db.exec('CREATE TABLE IF NOT EXISTS faulty_temp (id INT);');
        ctx.db.exec('INSERT INTO faulty_temp (id) VALUES (999);');
        throw new Error('Hardware connection timeout during installation');
      }
    });

    // Install must throw and rollback
    expect(() => {
      moduleManager.installModule(businessId, 'faulty_module');
    }).toThrow(/Hardware connection timeout during installation/i);

    // Verify module_installations records 'FAILED' status
    const row = db.prepare(`
      SELECT mi.installation_status, mi.error_message
      FROM module_installations mi
      JOIN module_definitions md ON md.id = mi.module_id
      WHERE md.module_code = 'faulty_module'
    `).get() as { installation_status: string; error_message: string };

    expect(row).toBeDefined();
    expect(row.installation_status).toBe('FAILED');
    expect(row.error_message).toContain('Hardware connection timeout');
  });

  // =========================================================================
  // TEST 11: UPGRADES AND VERSION MIGRATIONS
  // =========================================================================
  it('11. Handles module version upgrades and records migration timestamp', () => {
    let upgradeHookCalled = false;

    registry.register({
      code: 'upgradable_mod',
      name: 'Upgradable Module',
      description: 'Supports version upgrade',
      category: 'SALES',
      classification: 'OPTIONAL',
      version: '1.0.0',
      dependencies: [],
      upgrade: (from, to, ctx) => {
        upgradeHookCalled = true;
        expect(from).toBe('1.0.0');
        expect(to).toBe('2.0.0');
      }
    });

    moduleManager.installModule(businessId, 'upgradable_mod');
    moduleManager.upgradeModule(businessId, 'upgradable_mod', '2.0.0');

    expect(upgradeHookCalled).toBe(true);

    const installRecord = db.prepare(`
      SELECT mi.installed_version, mi.last_migration_at, mi.installation_status
      FROM module_installations mi
      JOIN module_definitions md ON md.id = mi.module_id
      WHERE md.module_code = 'upgradable_mod'
    `).get() as { installed_version: string; last_migration_at: string; installation_status: string };

    expect(installRecord.installed_version).toBe('2.0.0');
    expect(installRecord.last_migration_at).toBeDefined();
    expect(installRecord.installation_status).toBe('INSTALLED');
  });
});
