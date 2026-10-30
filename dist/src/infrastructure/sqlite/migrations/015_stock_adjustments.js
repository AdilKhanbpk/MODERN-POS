"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV15 = applyMigrationV15;
exports.up = up;
/**
 * Migration 015: Controlled Stock Adjustments & Approval Policies (Prompt 13)
 *
 * Implements:
 * 1. stock_adjustments with UUID PK, location FK, status state machine, audit trail
 * 2. stock_adjustment_lines with snapshot system_quantity_scaled, counted_quantity_scaled, and difference
 * 3. stock_adjustment_approval_policies per business for thresholds, roles, and self-approval controls
 * 4. Safe upgrade from legacy stock_adjustments table if present
 */
function applyMigrationV15(db) {
    const tx = db.transaction(() => {
        up(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(15, '015_stock_adjustments');
    });
    tx();
}
function up(db) {
    // Check if legacy stock_adjustments table exists without business_id
    const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_adjustments'")
        .get();
    if (tableCheck) {
        const cols = db.prepare("PRAGMA table_info('stock_adjustments')").all().map((c) => c.name);
        if (!cols.includes('business_id')) {
            // Legacy table found - rename to preserve historical records
            db.exec(`ALTER TABLE stock_adjustments RENAME TO stock_adjustments_legacy;`);
            if (db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_adjustment_lines'")
                .get()) {
                db.exec(`ALTER TABLE stock_adjustment_lines RENAME TO stock_adjustment_lines_legacy;`);
            }
        }
        else {
            // Already modernized
            return;
        }
    }
    // 1. CREATE STOCK ADJUSTMENTS TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      adjustment_number VARCHAR(50) NOT NULL,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      adjustment_type VARCHAR(30) NOT NULL CHECK(adjustment_type IN ('increase', 'decrease', 'damage', 'expiry', 'correction', 'other')),
      reason_code VARCHAR(50) NOT NULL,
      reason_description TEXT NOT NULL,
      status VARCHAR(30) NOT NULL CHECK(status IN ('draft', 'pending_approval', 'approved', 'posted', 'rejected', 'cancelled')),
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      posted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      requested_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      approved_at TEXT,
      posted_at TEXT,
      idempotency_key VARCHAR(150) NOT NULL,
      reversal_of_id TEXT REFERENCES stock_adjustments(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),

      -- Legacy compatibility columns
      location_id INTEGER DEFAULT 1,
      reason TEXT,
      created_by INTEGER,

      UNIQUE (business_id, adjustment_number),
      UNIQUE (business_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_adjustments_biz_branch
      ON stock_adjustments(business_id, branch_id);

    CREATE INDEX IF NOT EXISTS idx_stock_adjustments_location
      ON stock_adjustments(stock_location_id);

    CREATE INDEX IF NOT EXISTS idx_stock_adjustments_status
      ON stock_adjustments(status);

    CREATE INDEX IF NOT EXISTS idx_stock_adjustments_type
      ON stock_adjustments(adjustment_type);
  `);
    // 2. CREATE STOCK ADJUSTMENT LINES TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      adjustment_id TEXT NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
      batch_id TEXT REFERENCES product_batches(id) ON DELETE RESTRICT,
      system_quantity_scaled BIGINT NOT NULL,
      counted_quantity_scaled BIGINT NOT NULL,
      difference_quantity_scaled BIGINT NOT NULL,
      unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      unit_cost_minor BIGINT,
      total_value_minor BIGINT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),

      -- Legacy compatibility columns
      system_quantity REAL DEFAULT 0,
      counted_quantity REAL DEFAULT 0,
      difference_quantity REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_stock_adj_lines_adj_id
      ON stock_adjustment_lines(adjustment_id);

    CREATE INDEX IF NOT EXISTS idx_stock_adj_lines_product
      ON stock_adjustment_lines(product_id);
  `);
    // 3. CREATE STOCK ADJUSTMENT APPROVAL POLICIES TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stock_adjustment_approval_policies (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
      max_auto_approve_qty_scaled BIGINT NOT NULL DEFAULT 5000,
      max_auto_approve_value_minor BIGINT NOT NULL DEFAULT 500000,
      require_approval_for_types TEXT NOT NULL DEFAULT '["damage","expiry","other"]',
      allow_self_approval INTEGER NOT NULL DEFAULT 0 CHECK(allow_self_approval IN (0, 1)),
      approver_roles TEXT NOT NULL DEFAULT '["OWNER","ADMINISTRATOR","MANAGER"]',
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );
  `);
    // 4. SEED DEFAULT POLICY FOR INITIAL BUSINESS
    db.exec(`
    INSERT OR IGNORE INTO stock_adjustment_approval_policies (
      id, business_id, max_auto_approve_qty_scaled, max_auto_approve_value_minor,
      require_approval_for_types, allow_self_approval, approver_roles
    ) VALUES (
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000001',
      5000,
      500000,
      '["damage","expiry","other"]',
      0,
      '["OWNER","ADMINISTRATOR","MANAGER"]'
    );
  `);
}
