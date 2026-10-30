"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV20 = applyMigrationV20;
exports.up = up;
exports.down = down;
/**
 * Migration 020: Stock Replenishment Rules & Purchase Suggestions (Prompt 18)
 */
function applyMigrationV20(db) {
    const tx = db.transaction(() => {
        up(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(20, '020_stock_replenishment_and_monitoring');
    });
    tx();
}
function up(db) {
    // 1. PRODUCT REORDER RULES
    db.exec(`
    CREATE TABLE IF NOT EXISTS product_reorder_rules (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      stock_location_id TEXT REFERENCES stock_locations(id) ON DELETE CASCADE,
      minimum_stock_scaled BIGINT NOT NULL DEFAULT 0,
      reorder_point_scaled BIGINT NOT NULL DEFAULT 0,
      target_stock_scaled BIGINT NOT NULL DEFAULT 0,
      preferred_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
      preferred_purchase_unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
      lead_time_days INTEGER NOT NULL DEFAULT 0,
      safety_stock_scaled BIGINT NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reorder_rules_unique
      ON product_reorder_rules(business_id, product_id, COALESCE(stock_location_id, ''));

    CREATE INDEX IF NOT EXISTS idx_reorder_rules_biz_prod
      ON product_reorder_rules(business_id, product_id);

    CREATE INDEX IF NOT EXISTS idx_reorder_rules_supplier
      ON product_reorder_rules(preferred_supplier_id);
  `);
    // 2. REPLENISHMENT SUGGESTIONS
    db.exec(`
    CREATE TABLE IF NOT EXISTS replenishment_suggestions (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      suggested_quantity_scaled BIGINT NOT NULL,
      current_available_scaled BIGINT NOT NULL,
      target_stock_scaled BIGINT NOT NULL,
      calculation_reason TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'converted', 'dismissed')),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_replenish_biz_status
      ON replenishment_suggestions(business_id, status);

    CREATE INDEX IF NOT EXISTS idx_replenish_prod_loc
      ON replenishment_suggestions(product_id, stock_location_id);
  `);
}
function down(db) {
    db.exec(`DROP TABLE IF EXISTS replenishment_suggestions;`);
    db.exec(`DROP TABLE IF EXISTS product_reorder_rules;`);
    db.prepare('DELETE FROM schema_migrations WHERE version = 20').run();
}
