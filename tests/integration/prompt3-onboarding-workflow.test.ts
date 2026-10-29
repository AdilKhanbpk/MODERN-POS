import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { OnboardingService } from '../../src/application/services/OnboardingService';
import { OnboardingPayload, OnboardingDraft } from '../../src/shared/types/onboarding';
import { ValidationError, AppError } from '../../src/shared/errors/AppError';

describe('Prompt 3 — Business Onboarding and Configuration Workflow', () => {
  let db: Database.Database;
  let onboardingService: OnboardingService;

  const validPayload: OnboardingPayload = {
    businessInfo: {
      name: 'Al-Madina Supermarket',
      legalName: 'Al-Madina Retail Pvt Ltd',
      registrationNumber: 'NTN-9876543-1',
      phone: '0300-1234567',
      email: 'info@almadina.pk',
      address: 'Main Commercial Market, Sector G-9, Islamabad'
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
      defaultMeasurementUnit: 'Kilogram'
    },
    branch: {
      name: 'Islamabad Flagship Branch',
      code: 'ISB-01',
      address: 'Sector G-9 Markaz, Islamabad',
      phone: '051-2233445'
    },
    counter: {
      name: 'Main Express Counter',
      code: 'REG-01',
      deviceIdentifier: 'POS-TERM-ISB-01'
    },
    adminAccount: {
      fullName: 'Muhammad Usman',
      username: 'owner_usman',
      password: 'SecureMasterPassword123!',
      passwordConfirm: 'SecureMasterPassword123!',
      email: 'usman@almadina.pk',
      phone: '0300-1234567'
    },
    modules: {
      enabledModuleCodes: ['weighing_scale', 'batch_expiry', 'customer_ledger', 'supplier_payables', 'bulk_pricing']
    },
    receiptSettings: {
      displayName: 'AL-MADINA SUPERMARKET',
      address: 'Sector G-9 Markaz, Islamabad',
      phone: 'UAN: 051-111-222-333',
      heading: 'TAX INVOICE',
      footerMessage: 'Thank you for shopping at Al-Madina! Items exchangeable within 7 days with invoice.',
      paperWidth: '80mm',
      showCustomerDetails: true,
      showTaxDetails: true,
      showCashierName: true,
      showBarcodeOrQr: true
    }
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    onboardingService = new OnboardingService(db);
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // TEST 1: SUCCESSFUL ONBOARDING & ATOMIC CREATION
  // =========================================================================
  it('1. Successfully completes onboarding and creates all enterprise records atomically', () => {
    // Initially onboarding is not completed
    expect(onboardingService.isOnboardingCompleted()).toBe(false);

    // Complete onboarding
    const result = onboardingService.completeOnboarding(validPayload);
    expect(result.businessId).toBeDefined();
    expect(result.branchId).toBeDefined();
    expect(result.counterId).toBeDefined();
    expect(result.userId).toBeDefined();

    // Verify Business
    const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(result.businessId) as any;
    expect(biz).toBeDefined();
    expect(biz.name).toBe('Al-Madina Supermarket');
    expect(biz.business_type).toBe('SUPERMARKET');
    expect(biz.default_currency).toBe('PKR');
    expect(biz.is_active).toBe(1);

    // Verify Branch
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(result.branchId) as any;
    expect(branch).toBeDefined();
    expect(branch.business_id).toBe(result.businessId);
    expect(branch.code).toBe('ISB-01');

    // Verify Counter
    const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(result.counterId) as any;
    expect(counter).toBeDefined();
    expect(counter.branch_id).toBe(result.branchId);
    expect(counter.business_id).toBe(result.businessId);
    expect(counter.code).toBe('REG-01');

    // Verify Owner User & Password Hash (Plain-text strictly forbidden)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId) as any;
    expect(user).toBeDefined();
    expect(user.username).toBe('owner_usman');
    expect(user.password_hash).not.toBe('SecureMasterPassword123!');
    expect(bcrypt.compareSync('SecureMasterPassword123!', user.password_hash)).toBe(true);

    // Verify Admin Role & Permissions
    const userRole = db.prepare('SELECT * FROM user_roles WHERE user_id = ?').get(result.userId) as any;
    expect(userRole).toBeDefined();
    expect(userRole.business_id).toBe(result.businessId);

    const adminRole = db.prepare('SELECT * FROM roles WHERE id = ?').get(userRole.role_id) as any;
    expect(adminRole.name).toBe('ADMIN');
    expect(adminRole.is_system_role).toBe(1);

    const rolePerms = db.prepare('SELECT * FROM role_permissions WHERE role_id = ?').all(adminRole.id);
    expect(rolePerms.length).toBeGreaterThanOrEqual(9);

    // Verify User Branch Access
    const branchAccess = db.prepare('SELECT * FROM user_branch_access WHERE user_id = ? AND branch_id = ?').get(
      result.userId,
      result.branchId
    );
    expect(branchAccess).toBeDefined();

    // Verify Modules saved in business_modules
    const bizMods = db.prepare('SELECT bm.is_enabled, md.module_code FROM business_modules bm JOIN module_definitions md ON bm.module_id = md.id WHERE bm.business_id = ?').all(result.businessId) as any[];
    expect(bizMods.length).toBeGreaterThanOrEqual(10);

    const scaleMod = bizMods.find(m => m.module_code === 'weighing_scale');
    expect(scaleMod.is_enabled).toBe(1);

    const posMod = bizMods.find(m => m.module_code === 'pos_checkout');
    expect(posMod.is_enabled).toBe(1); // Core module always enabled

    // Verify Settings in business_settings
    const receiptSetting = db.prepare("SELECT setting_value FROM business_settings WHERE business_id = ? AND setting_key = 'receipt_settings'").get(result.businessId) as any;
    expect(receiptSetting).toBeDefined();
    const receiptJson = JSON.parse(receiptSetting.setting_value);
    expect(receiptJson.heading).toBe('TAX INVOICE');
    expect(receiptJson.paperWidth).toBe('80mm');

    // Verify Audit Log
    const audit = db.prepare("SELECT * FROM audit_logs WHERE business_id = ? AND action = 'BUSINESS_ONBOARDING_COMPLETED'").get(result.businessId) as any;
    expect(audit).toBeDefined();
    expect(audit.user_id).toBe(result.userId);

    // Verify App Settings mark complete
    expect(onboardingService.isOnboardingCompleted()).toBe(true);
    const status = onboardingService.getStatus();
    expect(status.isCompleted).toBe(true);
    expect(status.activeBusinessId).toBe(result.businessId);
    expect(status.businessName).toBe('Al-Madina Supermarket');
  });

  // =========================================================================
  // TEST 2: MISSING REQUIRED FIELDS
  // =========================================================================
  it('2. Rejects onboarding with descriptive errors when required fields are missing', () => {
    // Missing business name
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        businessInfo: { ...validPayload.businessInfo, name: ' ' }
      });
    }).toThrow(ValidationError);

    // Missing phone
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        businessInfo: { ...validPayload.businessInfo, phone: '' }
      });
    }).toThrow(/phone number is required/i);

    // Missing branch code
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        branch: { ...validPayload.branch, code: '' }
      });
    }).toThrow(/branch code is required/i);

    // Missing counter code
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        counter: { ...validPayload.counter, code: '' }
      });
    }).toThrow(/counter code is required/i);

    // Admin password too short
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        adminAccount: { ...validPayload.adminAccount, password: '123' }
      });
    }).toThrow(/password must be at least 6 characters/i);
  });

  // =========================================================================
  // TEST 3: INVALID CURRENCY CODES
  // =========================================================================
  it('3. Rejects invalid currency codes not matching standard 3-letter ISO 4217', () => {
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        regionalSettings: { ...validPayload.regionalSettings, currencyCode: 'PK' }
      });
    }).toThrow(/Currency code must be a valid 3-letter ISO code/i);

    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        regionalSettings: { ...validPayload.regionalSettings, currencyCode: 'PAKISTAN' }
      });
    }).toThrow(/Currency code must be a valid 3-letter ISO code/i);

    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        regionalSettings: { ...validPayload.regionalSettings, currencyCode: '123' }
      });
    }).toThrow(/Currency code must be a valid 3-letter ISO code/i);
  });

  // =========================================================================
  // TEST 4: FAILED DATABASE WRITES (TRANSACTION ROLLBACK GUARANTEE)
  // =========================================================================
  it('4. Rolls back all records in transaction if an internal step fails', () => {
    const businessesBefore = db.prepare('SELECT COUNT(*) as count FROM businesses').get() as { count: number };
    const usersBefore = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

    // Deliberately trigger a database constraint failure by corrupting foreign keys or dropping a required table during tx
    // We can simulate this by mocking a temporary trigger or injecting an error
    db.exec(`
      CREATE TRIGGER trg_test_fail
      BEFORE INSERT ON user_roles
      WHEN NEW.business_id IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'Simulated sudden transaction abort in user_roles step');
      END;
    `);

    expect(() => {
      onboardingService.completeOnboarding(validPayload);
    }).toThrow(/Simulated sudden transaction abort/i);

    // Verify 100% rollback: NO businesses created, NO users created
    const businessesAfter = db.prepare('SELECT COUNT(*) as count FROM businesses').get() as { count: number };
    const usersAfter = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

    expect(businessesAfter.count).toBe(businessesBefore.count);
    expect(usersAfter.count).toBe(usersBefore.count);
    expect(onboardingService.isOnboardingCompleted()).toBe(false);

    // Cleanup trigger
    db.exec('DROP TRIGGER trg_test_fail;');
  });

  // =========================================================================
  // TEST 5: MODULE DEPENDENCY VALIDATION
  // =========================================================================
  it('5. Validates module dependencies (e.g. FEFO requires batch and expiry tracking)', () => {
    // Attempting to enable 'fefo_picking' without 'batch_expiry' must fail
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        modules: {
          enabledModuleCodes: ['fefo_picking'] // Missing 'batch_expiry'
        }
      });
    }).toThrow(/requires "Batch & Expiry Date Tracking" to be enabled/i);

    // Attempting to enable 'service_history' without 'serial_warranty' must fail
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        modules: {
          enabledModuleCodes: ['service_history'] // Missing 'serial_warranty'
        }
      });
    }).toThrow(/requires "Serial Number & Warranty Claims" to be enabled/i);

    // Enabling both 'fefo_picking' AND 'batch_expiry' succeeds
    expect(() => {
      onboardingService.completeOnboarding({
        ...validPayload,
        modules: {
          enabledModuleCodes: ['batch_expiry', 'fefo_picking']
        }
      });
    }).not.toThrow();
  });

  // =========================================================================
  // TEST 6: DISABLING AND RE-ENABLING A MODULE
  // =========================================================================
  it('6. Allows disabling and re-enabling a module post-onboarding without deleting historical records or tables', () => {
    const result = onboardingService.completeOnboarding(validPayload);

    // Disable 'weighing_scale'
    onboardingService.updateModuleStatus(result.businessId, 'weighing_scale', false, result.userId);

    const modsAfterDisable = onboardingService.getModuleDefinitions(result.businessId);
    const scaleModDisabled = modsAfterDisable.find(m => m.moduleCode === 'weighing_scale');
    expect(scaleModDisabled?.isEnabled).toBe(false);

    // Audit log recorded the disable action
    const auditDisable = db.prepare("SELECT * FROM audit_logs WHERE business_id = ? AND action = 'MODULE_DISABLED'").get(result.businessId);
    expect(auditDisable).toBeDefined();

    // Tables still exist completely intact
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.some((t: any) => t.name === 'stock_movements')).toBe(true);

    // Re-enable 'weighing_scale'
    onboardingService.updateModuleStatus(result.businessId, 'weighing_scale', true, result.userId);

    const modsAfterReEnable = onboardingService.getModuleDefinitions(result.businessId);
    const scaleModEnabled = modsAfterReEnable.find(m => m.moduleCode === 'weighing_scale');
    expect(scaleModEnabled?.isEnabled).toBe(true);

    // Disabling a prerequisite while dependent is active is rejected
    // First enable fefo_picking (batch_expiry is already enabled)
    onboardingService.updateModuleStatus(result.businessId, 'fefo_picking', true, result.userId);

    // Now try to disable batch_expiry while fefo_picking is active
    expect(() => {
      onboardingService.updateModuleStatus(result.businessId, 'batch_expiry', false, result.userId);
    }).toThrow(/Cannot disable "Batch & Expiry Date Tracking" because active module\(s\) \[FEFO Automated Picking\] depend on it/i);
  });

  // =========================================================================
  // TEST 7: REOPENING APPLICATION AFTER COMPLETED ONBOARDING
  // =========================================================================
  it('7. Application startup detects completed onboarding and returns active business profile', () => {
    // Before onboarding
    let status = onboardingService.getStatus();
    expect(status.isCompleted).toBe(false);
    expect(status.activeBusinessId).toBeUndefined();

    // Complete onboarding
    const result = onboardingService.completeOnboarding(validPayload);

    // After onboarding (simulating application restart)
    const restartService = new OnboardingService(db);
    status = restartService.getStatus();

    expect(status.isCompleted).toBe(true);
    expect(status.activeBusinessId).toBe(result.businessId);
    expect(status.businessName).toBe('Al-Madina Supermarket');
  });

  // =========================================================================
  // TEST 8: SAVING AND RESUMING AN INCOMPLETE ONBOARDING SESSION (DRAFT)
  // =========================================================================
  it('8. Saves and resumes an incomplete onboarding session with 100% data fidelity', () => {
    // No draft initially
    expect(onboardingService.getDraft()).toBeNull();

    const partialDraft: OnboardingDraft = {
      currentStep: 4,
      payload: {
        businessInfo: {
          name: 'Draft Grocery Shop',
          phone: '0311-9988776'
        },
        businessType: 'GROCERY',
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
        }
      },
      savedAt: new Date().toISOString()
    };

    // Save draft
    onboardingService.saveDraft(partialDraft);

    const statusWithDraft = onboardingService.getStatus();
    expect(statusWithDraft.hasDraft).toBe(true);
    expect(statusWithDraft.draftStep).toBe(4);

    // Retrieve draft
    const retrievedDraft = onboardingService.getDraft();
    expect(retrievedDraft).not.toBeNull();
    expect(retrievedDraft?.currentStep).toBe(4);
    expect(retrievedDraft?.payload.businessInfo?.name).toBe('Draft Grocery Shop');
    expect(retrievedDraft?.payload.businessType).toBe('GROCERY');

    // Complete onboarding using the restored data + remaining fields
    const completedPayload: OnboardingPayload = {
      ...validPayload,
      businessInfo: {
        ...validPayload.businessInfo,
        name: retrievedDraft!.payload.businessInfo!.name!,
        phone: retrievedDraft!.payload.businessInfo!.phone!
      },
      businessType: retrievedDraft!.payload.businessType!
    };

    const completion = onboardingService.completeOnboarding(completedPayload);
    expect(completion.businessId).toBeDefined();

    // Draft is automatically cleared upon completion
    expect(onboardingService.getDraft()).toBeNull();
    const finalStatus = onboardingService.getStatus();
    expect(finalStatus.isCompleted).toBe(true);
    expect(finalStatus.hasDraft).toBe(false);
  });
});

