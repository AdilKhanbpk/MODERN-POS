"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV16 = applyMigrationV16;
exports.up = up;
/**
 * Migration 016: Physical Stocktakes, Counting Workflows & Discrepancy Audits (Prompt 14)
 *
 * Implements:
 * 1. stocktakes table with count_mode (full, cycle, category, selected_products),
 *    counting_mode (blind, visible), freeze_stock toggle, and lifecycle statuses.
 * 2. stocktake_lines table with snapshot system quantity, cutoff movements, counted quantity,
 *    and discrepancy metrics.
 * 3. stocktake_count_entries table supporting multiple count attempts (recounts) per line.
 * 4. stocktake_policies table for discrepancy thresholds and blind counting rules.
 */
function applyMigrationV16(db) {
    const tx = db.transaction(() => {
        up(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(16, '016_stocktakes_and_physical_counting');
    });
    tx();
}
function up(db) {
    // 1. CREATE STOCKTAKES TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stocktakes (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      stocktake_number VARCHAR(50) NOT NULL,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      count_mode VARCHAR(30) NOT NULL CHECK(count_mode IN ('full', 'cycle', 'category', 'selected_products')),
      counting_mode VARCHAR(30) NOT NULL CHECK(counting_mode IN ('blind', 'visible')),
      status VARCHAR(30) NOT NULL CHECK(status IN ('draft', 'in_progress', 'count_submitted', 'review', 'approved', 'posted', 'cancelled')),
      freeze_stock BOOLEAN NOT NULL DEFAULT 0,
      scope_category_id TEXT REFERENCES product_categories(id) ON DELETE SET NULL,
      scope_config_json TEXT,
      snapshot_at TEXT,
      started_at TEXT,
      submitted_at TEXT,
      approved_at TEXT,
      posted_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT,
      idempotency_key VARCHAR(150),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),

      UNIQUE (business_id, stocktake_number)
    );

    CREATE INDEX IF NOT EXISTS idx_stocktakes_biz_branch
      ON stocktakes(business_id, branch_id);

    CREATE INDEX IF NOT EXISTS idx_stocktakes_location
      ON stocktakes(stock_location_id);

    CREATE INDEX IF NOT EXISTS idx_stocktakes_status
      ON stocktakes(status);
  `);
    // 2. CREATE STOCKTAKE LINES TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stocktake_lines (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      stocktake_id TEXT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
      batch_id TEXT REFERENCES product_batches(id) ON DELETE SET NULL,
      system_quantity_scaled BIGINT NOT NULL,
      counted_quantity_scaled BIGINT,
      difference_quantity_scaled BIGINT,
      unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      unit_cost_minor BIGINT,
      difference_value_minor BIGINT,
      count_status VARCHAR(30) NOT NULL CHECK(count_status IN ('uncounted', 'counted', 'recount_required', 'resolved', 'disputed', 'abandoned')),
      counted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      counted_at TEXT,
      cutoff_movements_qty_scaled BIGINT NOT NULL DEFAULT 0,
      expected_quantity_scaled BIGINT NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_stocktake_lines_product
      ON stocktake_lines(stocktake_id, product_id, IFNULL(variant_id, ''), IFNULL(batch_id, ''));

    CREATE INDEX IF NOT EXISTS idx_stocktake_lines_st
      ON stocktake_lines(stocktake_id);

    CREATE INDEX IF NOT EXISTS idx_stocktake_lines_prod
      ON stocktake_lines(product_id);
  `);
    // 3. CREATE STOCKTAKE COUNT ENTRIES TABLE (recounts history)
    db.exec(`
    CREATE TABLE IF NOT EXISTS stocktake_count_entries (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      stocktake_line_id TEXT NOT NULL REFERENCES stocktake_lines(id) ON DELETE CASCADE,
      count_sequence INTEGER NOT NULL,
      counted_quantity_scaled BIGINT NOT NULL,
      counted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      counted_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      device_identifier VARCHAR(100),
      notes TEXT,
      is_accepted BOOLEAN NOT NULL DEFAULT 0,

      UNIQUE (stocktake_line_id, count_sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_stocktake_counts_line
      ON stocktake_count_entries(stocktake_line_id);
  `);
    // 4. CREATE STOCKTAKE POLICIES TABLE
    db.exec(`
    CREATE TABLE IF NOT EXISTS stocktake_policies (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE RESTRICT,
      auto_recount_qty_threshold_scaled BIGINT NOT NULL DEFAULT 5000,
      auto_recount_value_threshold_minor BIGINT NOT NULL DEFAULT 500000,
      allow_blind_counting BOOLEAN NOT NULL DEFAULT 1,
      default_counting_mode VARCHAR(30) NOT NULL DEFAULT 'blind' CHECK(default_counting_mode IN ('blind', 'visible')),
      allow_emergency_freeze_override BOOLEAN NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    -- Seed default policy for initial business if business exists
    INSERT OR IGNORE INTO stocktake_policies (
      id, business_id, auto_recount_qty_threshold_scaled, auto_recount_value_threshold_minor,
      allow_blind_counting, default_counting_mode, allow_emergency_freeze_override
    ) VALUES (
      '00000000-0000-0000-0000-000000000016',
      '00000000-0000-0000-0000-000000000001',
      5000,
      500000,
      1,
      'blind',
      1
    );
  `);
}
