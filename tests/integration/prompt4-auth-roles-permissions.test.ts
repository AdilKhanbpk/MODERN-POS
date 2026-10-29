import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { AuthService } from '../../src/application/services/AuthService';
import { RbacService } from '../../src/application/authorization/RbacService';
import { ApprovalService } from '../../src/application/services/ApprovalService';
import { OnboardingService } from '../../src/application/services/OnboardingService';
import { UnauthorizedError, ForbiddenError, ValidationError, ConflictError } from '../../src/shared/errors/AppError';

describe('Prompt 4 — Authentication, Granular Roles, Permissions & Approvals', () => {
  let db: Database.Database;
  let authService: AuthService;
  let rbacService: RbacService;
  let approvalService: ApprovalService;
  let onboardingService: OnboardingService;

  let businessId: string;
  let branchAId: string;
  let branchBId: string;
  let ownerUserId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    authService = new AuthService(db);
    rbacService = new RbacService(db);
    approvalService = new ApprovalService(db);
    onboardingService = new OnboardingService(db);

    // Setup initial store via OnboardingService
    const setup = onboardingService.completeOnboarding({
      businessInfo: {
        name: 'Metro Retail Mart',
        phone: '0300-1112233'
      },
      businessType: 'GENERAL_RETAIL',
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
        name: 'Branch North',
        code: 'BR-NORTH'
      },
      counter: {
        name: 'Register 1',
        code: 'REG-01'
      },
      adminAccount: {
        fullName: 'Store Proprietor',
        username: 'metro_owner',
        password: 'MasterOwnerPassword123!',
        passwordConfirm: 'MasterOwnerPassword123!'
      },
      modules: {
        enabledModuleCodes: ['customer_ledger', 'supplier_payables']
      },
      receiptSettings: {
        displayName: 'METRO RETAIL MART',
        heading: 'TAX INVOICE',
        footerMessage: 'Thank you for shopping with us!',
        paperWidth: '80mm',
        showCustomerDetails: true,
        showTaxDetails: true,
        showCashierName: true,
        showBarcodeOrQr: true
      }
    });

    businessId = setup.businessId;
    branchAId = setup.branchId;
    ownerUserId = setup.userId;

    // Create a second branch in the same business
    branchBId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO branches (id, business_id, name, code, is_active)
      VALUES (?, ?, 'Branch South', 'BR-SOUTH', 1)
    `).run(branchBId, businessId);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create employee users with specific roles and branch assignments
  function createTestEmployee(username: string, roleName: string, branchId: string): string {
    const userId = crypto.randomUUID();
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('EmployeePassword123!', salt);

    db.prepare(`
      INSERT INTO users (id, business_id, username, password_hash, full_name, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(userId, businessId, username, passwordHash, `Test ${roleName}`);

    // Map role
    const roleRow = db.prepare('SELECT id FROM roles WHERE business_id = ? AND name = ?').get(businessId, roleName) as any;
    if (roleRow) {
      db.prepare('INSERT INTO user_roles (user_id, role_id, business_id) VALUES (?, ?, ?)').run(userId, roleRow.id, businessId);
    }

    // Map branch access
    db.prepare('INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)').run(userId, branchId);

    return userId;
  }

  // =========================================================================
  // TEST 1: AUTHENTICATION, PASSWORD HASHING & SESSION ISSUANCE
  // =========================================================================
  it('1. Authenticates users, validates password hash, tracks last login, and issues opaque session token', () => {
    // Verify password is NOT stored in plain text in database
    const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ownerUserId) as any;
    expect(userRow.password_hash).not.toBe('MasterOwnerPassword123!');
    expect(bcrypt.compareSync('MasterOwnerPassword123!', userRow.password_hash)).toBe(true);

    // Login with valid credentials
    const loginResult = authService.login({
      username: 'metro_owner',
      passwordPlain: 'MasterOwnerPassword123!',
      deviceIdentifier: 'POS-TERMINAL-01'
    });

    expect(loginResult.sessionToken).toBeDefined();
    expect(loginResult.sessionToken.length).toBe(64); // 32 bytes hex
    expect(loginResult.user.username).toBe('metro_owner');
    expect(loginResult.user.businessId).toBe(businessId);
    expect(loginResult.permissions.length).toBeGreaterThanOrEqual(10);

    // Verify last_login_at timestamp was updated
    const updatedUser = db.prepare('SELECT last_login_at FROM users WHERE id = ?').get(ownerUserId) as any;
    expect(updatedUser.last_login_at).toBeDefined();

    // Verify session stored as SHA-256 hash in user_sessions (plaintext token never stored!)
    const expectedHash = crypto.createHash('sha256').update(loginResult.sessionToken).digest('hex');
    const sessionRow = db.prepare('SELECT * FROM user_sessions WHERE session_token_hash = ?').get(expectedHash) as any;
    expect(sessionRow).toBeDefined();
    expect(sessionRow.user_id).toBe(ownerUserId);
    expect(sessionRow.revoked_at).toBeNull();

    // Verify audit log recorded login
    const audit = db.prepare("SELECT * FROM audit_logs WHERE user_id = ? AND action = 'USER_LOGIN_SUCCESS'").get(ownerUserId) as any;
    expect(audit).toBeDefined();
  });

  // =========================================================================
  // TEST 2: LOGIN ATTEMPT THROTTLING & ACCOUNT LOCKOUT POLICY
  // =========================================================================
  it('2. Throttles consecutive failed logins and locks account after reaching max failed attempts', () => {
    const cashierId = createTestEmployee('cashier_lockout_test', 'Cashier', branchAId);

    // 4 failed attempts (policy default = 5)
    for (let i = 1; i <= 4; i++) {
      expect(() => {
        authService.login({
          username: 'cashier_lockout_test',
          passwordPlain: 'WrongPassword'
        });
      }).toThrow(/Invalid username or password/i);

      const user = db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(cashierId) as any;
      expect(user.failed_login_attempts).toBe(i);
      expect(user.locked_until).toBeNull();
    }

    // 5th failed attempt triggers account lockout
    expect(() => {
      authService.login({
        username: 'cashier_lockout_test',
        passwordPlain: 'WrongPassword'
      });
    }).toThrow(/Account locked due to 5 consecutive failed login attempts/i);

    const lockedUser = db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(cashierId) as any;
    expect(lockedUser.failed_login_attempts).toBe(5);
    expect(lockedUser.locked_until).not.toBeNull();
    expect(new Date(lockedUser.locked_until).getTime()).toBeGreaterThan(Date.now());

    // Even with the CORRECT password, login is blocked while locked out
    expect(() => {
      authService.login({
        username: 'cashier_lockout_test',
        passwordPlain: 'EmployeePassword123!'
      });
    }).toThrow(/Account is temporarily locked due to multiple failed login attempts/i);

    // Verify audit log recorded lockout
    const lockoutAudit = db.prepare("SELECT * FROM audit_logs WHERE user_id = ? AND action = 'USER_ACCOUNT_LOCKED'").get(cashierId);
    expect(lockoutAudit).toBeDefined();
  });

  // =========================================================================
  // TEST 3: SESSION VERIFICATION, EXPIRATION & LOGOUT REVOCATION
  // =========================================================================
  it('3. Validates active session tokens, rejects expired sessions, and revokes on logout', () => {
    const loginResult = authService.login({
      username: 'metro_owner',
      passwordPlain: 'MasterOwnerPassword123!'
    });

    // 1. Verify active session builds valid SecurityContext
    const context = authService.verifySession(loginResult.sessionToken);
    expect(context.userId).toBe(ownerUserId);
    expect(context.username).toBe('metro_owner');
    expect(context.businessId).toBe(businessId);

    // 2. Reject expired session
    const sessionTokenHash = crypto.createHash('sha256').update(loginResult.sessionToken).digest('hex');
    db.prepare("UPDATE user_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE session_token_hash = ?").run(sessionTokenHash);

    expect(() => {
      authService.verifySession(loginResult.sessionToken);
    }).toThrow(/Session expired/i);

    // 3. Reject revoked session upon logout
    const login2 = authService.login({
      username: 'metro_owner',
      passwordPlain: 'MasterOwnerPassword123!'
    });
    expect(authService.verifySession(login2.sessionToken)).toBeDefined();

    authService.logout(login2.sessionToken);

    expect(() => {
      authService.verifySession(login2.sessionToken);
    }).toThrow(/Session has been revoked/i);
  });

  // =========================================================================
  // TEST 4: DEFAULT 8 ROLES & GRANULAR PERMISSIONS
  // =========================================================================
  it('4. Seeds all 8 default enterprise roles with appropriate granular permissions', () => {
    const roles = db.prepare('SELECT name, is_system_role FROM roles WHERE business_id = ?').all(businessId) as any[];
    const roleNames = roles.map(r => r.name);

    const expected8Roles = [
      'Owner',
      'Administrator',
      'Manager',
      'Cashier',
      'Inventory Manager',
      'Purchase Manager',
      'Accountant',
      'Auditor'
    ];

    for (const r of expected8Roles) {
      expect(roleNames, `Role "${r}" must exist in the database`).toContain(r);
    }

    // Verify Cashier permissions
    const cashierId = createTestEmployee('cashier_perm_test', 'Cashier', branchAId);
    const cashierPerms = rbacService.getUserPermissions(cashierId, businessId);

    expect(cashierPerms.has('sales.create')).toBe(true);
    expect(cashierPerms.has('sales.post')).toBe(true);
    expect(cashierPerms.has('sales.discount.apply')).toBe(true);
    expect(cashierPerms.has('payments.receive')).toBe(true);

    // Cashier must NOT have price override, cost view, or profit report
    expect(cashierPerms.has('sales.price.override')).toBe(false);
    expect(cashierPerms.has('inventory.view_cost')).toBe(false);
    expect(cashierPerms.has('reports.profit')).toBe(false);
    expect(cashierPerms.has('products.change_cost')).toBe(false);

    // Verify Auditor permissions (Read-only)
    const auditorId = createTestEmployee('auditor_perm_test', 'Auditor', branchAId);
    const auditorPerms = rbacService.getUserPermissions(auditorId, businessId);

    expect(auditorPerms.has('audit.view')).toBe(true);
    expect(auditorPerms.has('reports.sales')).toBe(true);
    expect(auditorPerms.has('reports.profit')).toBe(true);
    expect(auditorPerms.has('sales.create')).toBe(false); // Read-only!
    expect(auditorPerms.has('inventory.adjust')).toBe(false); // Read-only!
  });

  // =========================================================================
  // TEST 5: BACKEND SERVICE AUTHORIZATION ENFORCEMENT
  // =========================================================================
  it('5. Enforces permission checks in backend services for protected operations (direct IPC/API call guard)', () => {
    const cashierId = createTestEmployee('cashier_auth_guard', 'Cashier', branchAId);
    const cashierLogin = authService.login({
      username: 'cashier_auth_guard',
      passwordPlain: 'EmployeePassword123!'
    });
    const cashierContext = authService.verifySession(cashierLogin.sessionToken);

    // 1. Cashier can create a sale
    expect(() => {
      rbacService.assertPermission(cashierContext, 'sales.create', 'Create POS invoice');
    }).not.toThrow();

    // 2. Cashier CANNOT override a price without permission
    expect(() => {
      rbacService.assertPermission(cashierContext, 'sales.price.override', 'Override product sales price');
    }).toThrow(ForbiddenError);

    // 3. Cashier CANNOT view profit reports
    expect(() => {
      rbacService.assertPermission(cashierContext, 'reports.profit', 'View profit and margins report');
    }).toThrow(ForbiddenError);

    // 4. Cashier CANNOT reverse a payment
    expect(() => {
      rbacService.assertPermission(cashierContext, 'payments.reverse', 'Reverse posted customer payment');
    }).toThrow(ForbiddenError);

    // 5. Manager CAN override prices and view profit
    const managerId = createTestEmployee('manager_auth_guard', 'Manager', branchAId);
    const managerLogin = authService.login({
      username: 'manager_auth_guard',
      passwordPlain: 'EmployeePassword123!'
    });
    const managerContext = authService.verifySession(managerLogin.sessionToken);

    expect(() => {
      rbacService.assertPermission(managerContext, 'sales.price.override');
      rbacService.assertPermission(managerContext, 'reports.profit');
      rbacService.assertPermission(managerContext, 'payments.reverse');
    }).not.toThrow();
  });

  // =========================================================================
  // TEST 6: CROSS-BRANCH ACCESS PROTECTION
  // =========================================================================
  it('6. Strictly prevents cross-branch access for localized store employees', () => {
    const cashierNorth = createTestEmployee('cashier_north', 'Cashier', branchAId);
    const loginNorth = authService.login({
      username: 'cashier_north',
      passwordPlain: 'EmployeePassword123!'
    });
    const contextNorth = authService.verifySession(loginNorth.sessionToken);

    // Access to Branch A (North) succeeds
    expect(() => {
      rbacService.assertBranchAccess(contextNorth, branchAId);
    }).not.toThrow();

    // Access to Branch B (South) must throw cross-branch access violation
    expect(() => {
      rbacService.assertBranchAccess(contextNorth, branchBId);
    }).toThrow(/Cross-branch access violation/i);

    // Owner / Administrator has multi-branch access across both branches
    const ownerLogin = authService.login({
      username: 'metro_owner',
      passwordPlain: 'MasterOwnerPassword123!'
    });
    const ownerContext = authService.verifySession(ownerLogin.sessionToken);

    expect(() => {
      rbacService.assertBranchAccess(ownerContext, branchAId);
      rbacService.assertBranchAccess(ownerContext, branchBId);
    }).not.toThrow();
  });

  // =========================================================================
  // TEST 7: SENSITIVE COST AND PROFIT DATA MASKING
  // =========================================================================
  it('7. Masks purchase cost and gross margin data for unauthorized cashiers', () => {
    const cashierId = createTestEmployee('cashier_masking', 'Cashier', branchAId);
    const cashierLogin = authService.login({
      username: 'cashier_masking',
      passwordPlain: 'EmployeePassword123!'
    });
    const cashierContext = authService.verifySession(cashierLogin.sessionToken);

    const productRecord = {
      id: 101,
      name: 'Organic Basmati Rice 5kg',
      selling_price: 150000,
      cost_price: 110000,
      default_cost_minor: 110000
    };

    // Filter cost for Cashier: cost_price and default_cost_minor removed
    const maskedForCashier = rbacService.filterSensitiveCost(productRecord, cashierContext);
    expect(maskedForCashier.selling_price).toBe(150000);
    expect(maskedForCashier.cost_price).toBeUndefined();
    expect(maskedForCashier.default_cost_minor).toBeUndefined();

    // Filter cost for Manager: cost_price preserved
    const managerId = createTestEmployee('manager_masking', 'Manager', branchAId);
    const managerLogin = authService.login({
      username: 'manager_masking',
      passwordPlain: 'EmployeePassword123!'
    });
    const managerContext = authService.verifySession(managerLogin.sessionToken);

    const visibleForManager = rbacService.filterSensitiveCost(productRecord, managerContext);
    expect(visibleForManager.cost_price).toBe(110000);
  });

  // =========================================================================
  // TEST 8: APPROVAL WORKFLOWS & SELF-APPROVAL PREVENTION
  // =========================================================================
  it('8. Supports supervisor override requests and strictly prevents employees from approving their own requests', () => {
    const cashierId = createTestEmployee('cashier_approval_test', 'Cashier', branchAId);
    const cashierLogin = authService.login({
      username: 'cashier_approval_test',
      passwordPlain: 'EmployeePassword123!'
    });
    const cashierContext = authService.verifySession(cashierLogin.sessionToken);

    const managerId = createTestEmployee('manager_approval_test', 'Manager', branchAId);
    const managerLogin = authService.login({
      username: 'manager_approval_test',
      passwordPlain: 'EmployeePassword123!'
    });
    const managerContext = authService.verifySession(managerLogin.sessionToken);

    // 1. Cashier creates discount override request (> 10%)
    const request = approvalService.createRequest(cashierContext, {
      branchId: branchAId,
      requestType: 'DISCOUNT_OVERRIDE',
      entityType: 'sale',
      originalValue: 10,
      proposedValue: 25,
      reason: 'VIP loyal customer wedding order discount',
      requestData: { invoice_estimate_minor: 5000000 }
    });

    expect(request.id).toBeDefined();
    expect(request.status).toBe('PENDING');
    expect(request.requestedBy).toBe(cashierId);

    // Verify request shows up in pending list
    const pendingList = approvalService.listPending(managerContext, branchAId);
    expect(pendingList.some(r => r.id === request.id)).toBe(true);

    // 2. Cashier attempts SELF-APPROVAL (Strictly prohibited by policy)
    expect(() => {
      approvalService.decideRequest(cashierContext, {
        requestId: request.id,
        decision: 'APPROVED',
        reason: 'I approve my own discount'
      });
    }).toThrow(/Self-approval violation: An employee cannot approve their own override request/i);

    // 3. Manager approves the request
    const approved = approvalService.decideRequest(managerContext, {
      requestId: request.id,
      decision: 'APPROVED',
      reason: 'Approved for VIP customer'
    });

    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe(managerId);
    expect(approved.decidedAt).toBeDefined();

    // Request is no longer in pending list
    const pendingAfter = approvalService.listPending(managerContext, branchAId);
    expect(pendingAfter.some(r => r.id === request.id)).toBe(false);

    // 4. Attempting to decide an already decided request fails
    expect(() => {
      approvalService.decideRequest(managerContext, {
        requestId: request.id,
        decision: 'REJECTED'
      });
    }).toThrow(ConflictError);

    // 5. Manager rejection workflow
    const rejectRequest = approvalService.createRequest(cashierContext, {
      branchId: branchAId,
      requestType: 'PRICE_OVERRIDE',
      entityType: 'sale_line',
      originalValue: '1000.00',
      proposedValue: '500.00',
      reason: 'Customer claims cheaper down the road'
    });

    const rejected = approvalService.decideRequest(managerContext, {
      requestId: rejectRequest.id,
      decision: 'REJECTED',
      reason: 'Selling below minimum wholesale cost'
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.approvedBy).toBe(managerId);
  });

  // =========================================================================
  // TEST 9: PASSWORD CHANGE & ADMIN PASSWORD RESET
  // =========================================================================
  it('9. Supports user password change and privileged admin password reset', () => {
    const cashierId = createTestEmployee('cashier_pw_test', 'Cashier', branchAId);

    // 1. User changes own password (verifying current password)
    expect(() => {
      authService.changePassword(cashierId, 'WrongOldPassword', 'BrandNewPassword456!');
    }).toThrow(/Current password is incorrect/i);

    authService.changePassword(cashierId, 'EmployeePassword123!', 'BrandNewPassword456!');

    // Login with new password succeeds
    const newLogin = authService.login({
      username: 'cashier_pw_test',
      passwordPlain: 'BrandNewPassword456!'
    });
    expect(newLogin.sessionToken).toBeDefined();

    // 2. Admin resets employee password
    const ownerLogin = authService.login({
      username: 'metro_owner',
      passwordPlain: 'MasterOwnerPassword123!'
    });
    const ownerContext = authService.verifySession(ownerLogin.sessionToken);

    authService.adminResetPassword(cashierId, 'ResetByAdminPass789!', ownerContext);

    // Login with admin-reset password succeeds
    const resetLogin = authService.login({
      username: 'cashier_pw_test',
      passwordPlain: 'ResetByAdminPass789!'
    });
    expect(resetLogin.sessionToken).toBeDefined();

    // 3. Unauthorized cashier attempts admin password reset on another user
    const cashierLogin = authService.login({
      username: 'cashier_pw_test',
      passwordPlain: 'ResetByAdminPass789!'
    });
    const cashierContext = authService.verifySession(cashierLogin.sessionToken);

    expect(() => {
      authService.adminResetPassword(ownerUserId, 'HackedPassword123!', cashierContext);
    }).toThrow(ForbiddenError);
  });
});

