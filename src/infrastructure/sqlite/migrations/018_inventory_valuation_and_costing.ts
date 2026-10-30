import Database from 'better-sqlite3';

function addColumnIfNotExists(db: Database.Database, table: string, column: string, typeDef: string): void {
  const info = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  if (!info.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
  }
}

/**
 * Migration 018: Inventory Valuation Engine (FIFO & Weighted Average Costing)
 * Prompt 16 Implementation
 */
export function applyMigrationV18(db: Database.Database): void {
  const tx = db.transaction(() => {
    up(db);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      18,
      '018_inventory_valuation_and_costing'
    );
  });
  tx();
}

export function up(db: Database.Database): void {
  // 1. EXTEND BUSINESSES WITH COSTING POLICIES
  addColumnIfNotExists(db, 'businesses', 'default_cost_method', "VARCHAR(30) NOT NULL DEFAULT 'fifo'");
  addColumnIfNotExists(db, 'businesses', 'backdating_policy', "VARCHAR(30) NOT NULL DEFAULT 'recalculate_adjustment'");
  addColumnIfNotExists(db, 'businesses', 'negative_stock_policy', "VARCHAR(30) NOT NULL DEFAULT 'block'");

  // 2. EXTEND SALE_ITEMS WITH COGS SNAPSHOT FIELDS
  addColumnIfNotExists(db, 'sale_items', 'costing_method', 'VARCHAR(30)');
  addColumnIfNotExists(db, 'sale_items', 'cogs_minor', 'BIGINT');
  addColumnIfNotExists(db, 'sale_items', 'cost_calculated_at', 'TEXT');
  addColumnIfNotExists(db, 'sale_items', 'currency_code', "CHAR(3) NOT NULL DEFAULT 'PKR'");
  addColumnIfNotExists(db, 'sale_items', 'cost_allocation_ref', 'TEXT');

  // 3. EXTEND STOCK_MOVEMENTS WITH VALUATION METRICS
  addColumnIfNotExists(db, 'stock_movements', 'cogs_minor', 'BIGINT');
  addColumnIfNotExists(db, 'stock_movements', 'cost_method', 'VARCHAR(30)');

  // 4. CREATE INVENTORY COST LAYERS TABLE (FIFO)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_cost_layers (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      source_movement_id TEXT REFERENCES stock_movements(id) ON DELETE SET NULL,
      received_quantity_scaled BIGINT NOT NULL,
      remaining_quantity_scaled BIGINT NOT NULL,
      unit_cost_minor BIGINT NOT NULL,
      currency_code CHAR(3) NOT NULL DEFAULT 'PKR',
      received_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_cost_layers_active
      ON inventory_cost_layers(business_id, product_id, stock_location_id, remaining_quantity_scaled);
    CREATE INDEX IF NOT EXISTS idx_cost_layers_received_at
      ON inventory_cost_layers(received_at ASC);
  `);

  // 5. CREATE INVENTORY COST ALLOCATIONS TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_cost_allocations (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      stock_location_id TEXT REFERENCES stock_locations(id) ON DELETE SET NULL,
      outbound_movement_id TEXT REFERENCES stock_movements(id) ON DELETE SET NULL,
      cost_layer_id TEXT REFERENCES inventory_cost_layers(id) ON DELETE SET NULL,
      reference_type VARCHAR(40),
      reference_id TEXT,
      reference_line_id TEXT,
      quantity_scaled BIGINT NOT NULL,
      unit_cost_minor BIGINT NOT NULL,
      allocated_cost_minor BIGINT NOT NULL,
      is_provisional INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_cost_alloc_reference
      ON inventory_cost_allocations(business_id, reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS idx_cost_alloc_layer
      ON inventory_cost_allocations(cost_layer_id);
  `);
  addColumnIfNotExists(db, 'inventory_cost_allocations', 'product_id', 'TEXT REFERENCES products(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'inventory_cost_allocations', 'stock_location_id', 'TEXT REFERENCES stock_locations(id) ON DELETE SET NULL');

  // 6. CREATE INVENTORY COST BALANCES TABLE (WEIGHTED AVERAGE)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_cost_balances (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      quantity_scaled BIGINT NOT NULL DEFAULT 0,
      inventory_value_minor BIGINT NOT NULL DEFAULT 0,
      average_unit_cost_numerator BIGINT NOT NULL DEFAULT 0,
      average_unit_cost_denominator BIGINT NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_balances_unique
      ON inventory_cost_balances(business_id, product_id, stock_location_id, COALESCE(variant_id, ''));
  `);

  // 7. CREATE INVENTORY REVALUATIONS TABLE (POLICY SWITCHES & BACKDATED ADJUSTMENTS)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_revaluations (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      old_cost_method VARCHAR(30) NOT NULL,
      new_cost_method VARCHAR(30) NOT NULL,
      old_inventory_value_minor BIGINT NOT NULL,
      new_inventory_value_minor BIGINT NOT NULL,
      revaluation_variance_minor BIGINT NOT NULL,
      reason TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_revaluations_product
      ON inventory_revaluations(business_id, product_id);
  `);
}
