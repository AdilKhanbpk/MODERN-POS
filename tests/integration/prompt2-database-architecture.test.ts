import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';

describe('Prompt 2 — Database Architecture, Referential Integrity & Audit Immutability', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // CONDITION 1: Branch cannot belong to a nonexistent business
  // =========================================================================
  it('Condition 1: rejects branch insertion if business_id does not exist in businesses table', () => {
    const nonexistentBusinessId = crypto.randomUUID();
    const branchId = crypto.randomUUID();

    expect(() => {
      db.prepare(`
        INSERT INTO branches (id, business_id, name, code)
        VALUES (?, ?, 'Orphan Branch', 'ORPH-01')
      `).run(branchId, nonexistentBusinessId);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  // =========================================================================
  // CONDITION 2: Counter cannot belong to a branch from another business
  // =========================================================================
  it('Condition 2: rejects counter creation when branch belongs to a different business (cross-business branch attack)', () => {
    // 1. Create Business A with Branch A
    const bizA = crypto.randomUUID();
    const branchA = crypto.randomUUID();
    db.prepare(`
      INSERT INTO businesses (id, name, business_type)
      VALUES (?, 'Enterprise Alpha', 'GENERAL_RETAIL')
    `).run(bizA);

    db.prepare(`
      INSERT INTO branches (id, business_id, name, code)
      VALUES (?, ?, 'Branch Alpha North', 'ALPHA-01')
    `).run(branchA, bizA);

    // 2. Create Business B with Branch B
    const bizB = crypto.randomUUID();
    const branchB = crypto.randomUUID();
    db.prepare(`
      INSERT INTO businesses (id, name, business_type)
      VALUES (?, 'Enterprise Beta', 'GROCERY')
    `).run(bizB);

    db.prepare(`
      INSERT INTO branches (id, business_id, name, code)
      VALUES (?, ?, 'Branch Beta South', 'BETA-01')
    `).run(branchB, bizB);

    // 3. Valid counter in Business A, Branch A succeeds
    const counterA = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO counters (id, business_id, branch_id, name, code)
        VALUES (?, ?, ?, 'Counter A1', 'C-01')
      `).run(counterA, bizA, branchA);
    }).not.toThrow();

    // 4. INVALID counter: specifies Business B, but points to Branch A (which belongs to Business A)
    const rogueCounter = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO counters (id, business_id, branch_id, name, code)
        VALUES (?, ?, ?, 'Rogue Counter', 'C-ROGUE')
      `).run(rogueCounter, bizB, branchA);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  // =========================================================================
  // CONDITION 3: Username cannot be duplicated inside the same business
  // =========================================================================
  it('Condition 3: enforces unique usernames per business, but allows identical usernames across distinct businesses', () => {
    const bizA = crypto.randomUUID();
    const bizB = crypto.randomUUID();

    db.prepare(`INSERT INTO businesses (id, name, business_type) VALUES (?, 'Corp 1', 'PHARMACY')`).run(bizA);
    db.prepare(`INSERT INTO businesses (id, name, business_type) VALUES (?, 'Corp 2', 'ELECTRONICS')`).run(bizB);

    // Insert user "manager_john" in Business A
    const userA = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, business_id, username, password_hash, full_name)
      VALUES (?, ?, 'manager_john', 'hash123', 'John Doe A')
    `).run(userA, bizA);

    // Inserting another "manager_john" in Business A must fail
    const duplicateUserA = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO users (id, business_id, username, password_hash, full_name)
        VALUES (?, ?, 'manager_john', 'hash456', 'John Doe Duplicate')
      `).run(duplicateUserA, bizA);
    }).toThrow(/UNIQUE constraint failed: users.business_id, users.username/i);

    // Inserting "manager_john" in Business B must succeed (isolated multi-tenancy)
    const userB = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO users (id, business_id, username, password_hash, full_name)
        VALUES (?, ?, 'manager_john', 'hash789', 'John Doe B')
      `).run(userB, bizB);
    }).not.toThrow();
  });

  // =========================================================================
  // CONDITION 4: Role cannot be assigned across unrelated businesses
  // =========================================================================
  it('Condition 4: rejects role assignments across unrelated businesses (cross-business role assignment)', () => {
    const bizA = crypto.randomUUID();
    const bizB = crypto.randomUUID();

    db.prepare(`INSERT INTO businesses (id, name, business_type) VALUES (?, 'Shop A', 'GENERAL_RETAIL')`).run(bizA);
    db.prepare(`INSERT INTO businesses (id, name, business_type) VALUES (?, 'Shop B', 'APPAREL')`).run(bizB);

    const userA = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, business_id, username, password_hash, full_name)
      VALUES (?, ?, 'clerk_a', 'hash_a', 'Clerk Alpha')
    `).run(userA, bizA);

    const roleB = crypto.randomUUID();
    db.prepare(`
      INSERT INTO roles (id, business_id, name, description)
      VALUES (?, ?, 'STORE_MANAGER', 'Manager for Shop B')
    `).run(roleB, bizB);

    // Case 1: Try assigning Role B to User A under Business A
    // (Fails because Role B does not belong to Business A)
    expect(() => {
      db.prepare(`
        INSERT INTO user_roles (user_id, role_id, business_id)
        VALUES (?, ?, ?)
      `).run(userA, roleB, bizA);
    }).toThrow(/FOREIGN KEY constraint failed/i);

    // Case 2: Try assigning Role B to User A under Business B
    // (Fails because User A does not belong to Business B)
    expect(() => {
      db.prepare(`
        INSERT INTO user_roles (user_id, role_id, business_id)
        VALUES (?, ?, ?)
      `).run(userA, roleB, bizB);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  // =========================================================================
  // CONDITION 5: Duplicate business module records are rejected
  // =========================================================================
  it('Condition 5: rejects duplicate business module registrations for the same business', () => {
    const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
    const weighingScaleModId = '00000000-0000-0000-0000-000000000045';

    // 1. Enable module for default business
    db.prepare(`
      INSERT INTO business_modules (id, business_id, module_id, is_enabled)
      VALUES (?, ?, ?, 1)
    `).run(crypto.randomUUID(), defaultBusinessId, weighingScaleModId);

    // 2. Attempting to insert duplicate record for same business and module must fail
    expect(() => {
      db.prepare(`
        INSERT INTO business_modules (id, business_id, module_id, is_enabled)
        VALUES (?, ?, ?, 1)
      `).run(crypto.randomUUID(), defaultBusinessId, weighingScaleModId);
    }).toThrow(/UNIQUE constraint failed: business_modules.business_id, business_modules.module_id/i);
  });

  // =========================================================================
  // CONDITION 6: Audit records cannot be deleted or updated (immutable triggers)
  // =========================================================================
  it('Condition 6: prohibits DELETE and UPDATE operations on audit_logs via database triggers', () => {
    const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
    const auditId = crypto.randomUUID();

    // 1. Insert valid audit record
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, action, entity_type, entity_id, reason)
      VALUES (?, ?, 'USER_LOGIN', 'user', 'user-123', 'Cashier logged in at morning shift')
    `).run(auditId, defaultBusinessId);

    const record = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(auditId) as any;
    expect(record).toBeDefined();
    expect(record.action).toBe('USER_LOGIN');

    // 2. Prohibit UPDATE
    expect(() => {
      db.prepare(`
        UPDATE audit_logs
        SET action = 'TAMPERED_ACTION'
        WHERE id = ?
      `).run(auditId);
    }).toThrow(/Audit log records are immutable and cannot be updated/i);

    // 3. Prohibit DELETE
    expect(() => {
      db.prepare(`
        DELETE FROM audit_logs
        WHERE id = ?
      `).run(auditId);
    }).toThrow(/Audit log records are append-only and cannot be deleted/i);

    // 4. Verify record is still pristine and unaltered
    const pristine = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(auditId) as any;
    expect(pristine.action).toBe('USER_LOGIN');
  });

  // =========================================================================
  // CONDITION 7: Fresh installation creates all required enterprise tables & indexes
  // =========================================================================
  it('Condition 7: verifies all enterprise multi-tenant tables, indexes, and seeded data exist', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    const requiredPrompt2Tables = [
      'businesses',
      'branches',
      'counters',
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'user_roles',
      'user_branch_access',
      'business_settings',
      'module_definitions',
      'business_modules',
      'audit_logs'
    ];

    for (const tbl of requiredPrompt2Tables) {
      expect(tableNames, `Table ${tbl} should exist`).toContain(tbl);
    }

    // Verify UUID format on seeded businesses
    const defaultBiz = db.prepare("SELECT id, name, default_currency FROM businesses WHERE id = '00000000-0000-0000-0000-000000000001'").get() as any;
    expect(defaultBiz).toBeDefined();
    expect(defaultBiz.name).toBe('Modern Retail POS Enterprise');
    expect(defaultBiz.default_currency).toBe('PKR');

    // Verify seeded branches
    const defaultBranch = db.prepare("SELECT id, code FROM branches WHERE code = 'HQ-01'").get() as any;
    expect(defaultBranch).toBeDefined();
    expect(defaultBranch.id).toBe('00000000-0000-0000-0000-000000000002');

    // Verify seeded counters
    const defaultCounter = db.prepare("SELECT id, code FROM counters WHERE code = 'REG-01'").get() as any;
    expect(defaultCounter).toBeDefined();
    expect(defaultCounter.id).toBe('00000000-0000-0000-0000-000000000003');

    // Verify seeded module definitions (core and vertical modules)
    const modules = db.prepare('SELECT module_code, is_core FROM module_definitions').all() as any[];
    expect(modules.length).toBeGreaterThanOrEqual(10);
    const posCheckout = modules.find(m => m.module_code === 'pos_checkout');
    expect(posCheckout).toBeDefined();
    expect(posCheckout.is_core).toBe(1);

    const weighingScale = modules.find(m => m.module_code === 'weighing_scale');
    expect(weighingScale).toBeDefined();
    expect(weighingScale.is_core).toBe(0);

    // Verify business_settings table structure and JSON support
    const settingId = crypto.randomUUID();
    const configData = { receipt_header: 'Welcome to Supermarket', max_credit_days: 30 };
    db.prepare(`
      INSERT INTO business_settings (id, business_id, setting_key, setting_value)
      VALUES (?, ?, 'pos_receipt_config', ?)
    `).run(settingId, defaultBiz.id, JSON.stringify(configData));

    const setting = db.prepare('SELECT setting_value FROM business_settings WHERE id = ?').get(settingId) as any;
    expect(JSON.parse(setting.setting_value)).toEqual(configData);

    // Verify unique indexes
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_branches_business');
    expect(indexNames).toContain('idx_counters_branch');
    expect(indexNames).toContain('idx_users_business');
    expect(indexNames).toContain('idx_roles_business');
    expect(indexNames).toContain('idx_biz_modules');
    expect(indexNames).toContain('idx_audit_biz');
    expect(indexNames).toContain('idx_audit_created');
  });
});

