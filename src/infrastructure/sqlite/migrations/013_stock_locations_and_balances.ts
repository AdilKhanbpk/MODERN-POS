import Database from 'better-sqlite3';

function addColumnIfNotExists(db: Database.Database, table: string, column: string, typeDef: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef};`);
  }
}

/**
 * Migration 013: Stock Locations, Counter Mappings & Warehouse Balances (Prompt 11)
 *
 * Implements:
 * 1. stock_locations (UUID PK, business_id, branch_id, parent_location_id, hierarchy, sellable/receivable flags)
 * 2. counter_stock_locations (links counter to authorized stock location with unique default per counter)
 * 3. stock_balances (transactional projection/cache with dual partial unique index for null & non-null variants)
 * 4. stock_transfers & stock_transfer_lines (internal location transfers and branch transfers)
 * 5. stock_movements extensions (stock_location_id, transfer_id)
 * 6. Seeds default stock location & counter link for default business/branch
 */
export function applyMigrationV13(db: Database.Database): void {
  const tx = db.transaction(() => {
    up(db);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      13,
      '013_stock_locations_and_balances'
    );
  });
  tx();
}

export function up(db: Database.Database): void {
  // 1. STOCK LOCATIONS
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_locations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      parent_location_id TEXT REFERENCES stock_locations(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      location_type TEXT NOT NULL CHECK(location_type IN ('shop_floor', 'warehouse', 'storeroom', 'damaged', 'quarantine', 'other')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      is_sellable INTEGER NOT NULL DEFAULT 1 CHECK(is_sellable IN (0, 1)),
      is_receivable INTEGER NOT NULL DEFAULT 1 CHECK(is_receivable IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (branch_id, code)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_locations_branch_default
      ON stock_locations(branch_id)
      WHERE is_default = 1 AND is_active = 1;

    CREATE INDEX IF NOT EXISTS idx_stock_locations_business
      ON stock_locations(business_id);

    CREATE INDEX IF NOT EXISTS idx_stock_locations_branch
      ON stock_locations(branch_id);

    CREATE INDEX IF NOT EXISTS idx_stock_locations_parent
      ON stock_locations(parent_location_id);
  `);

  // 2. COUNTER STOCK LOCATIONS
  db.exec(`
    CREATE TABLE IF NOT EXISTS counter_stock_locations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      counter_id TEXT NOT NULL REFERENCES counters(id) ON DELETE CASCADE,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      UNIQUE (counter_id, stock_location_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_stock_locations_default
      ON counter_stock_locations(counter_id)
      WHERE is_default = 1;

    CREATE INDEX IF NOT EXISTS idx_counter_stock_locations_counter
      ON counter_stock_locations(counter_id);
  `);

  // 3. UPGRADE STOCK BALANCES (Transactional Projection)
  // Check if legacy table exists without business_id or stock_location_id
  const tableInfo = db.prepare("PRAGMA table_info('stock_balances')").all() as Array<{ name: string }>;
  const hasStockLocId = tableInfo.some((col) => col.name === 'stock_location_id');

  if (tableInfo.length > 0 && !hasStockLocId) {
    db.exec(`ALTER TABLE stock_balances RENAME TO stock_balances_legacy;`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_balances (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      on_hand_scaled INTEGER NOT NULL DEFAULT 0,
      reserved_scaled INTEGER NOT NULL DEFAULT 0,
      available_scaled INTEGER NOT NULL DEFAULT 0,
      last_movement_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_balances_non_null_variant
      ON stock_balances(business_id, product_id, variant_id, stock_location_id)
      WHERE variant_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_balances_null_variant
      ON stock_balances(business_id, product_id, stock_location_id)
      WHERE variant_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_stock_balances_location
      ON stock_balances(stock_location_id, product_id);
  `);

  // 4. STOCK TRANSFERS & LINES
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      transfer_number TEXT NOT NULL UNIQUE,
      transfer_type TEXT NOT NULL CHECK(transfer_type IN ('internal', 'inter_branch', 'INTERNAL_LOCATION', 'BRANCH_TRANSFER')),
      source_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      destination_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      source_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      destination_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('draft', 'requested', 'approved', 'dispatched', 'partially_received', 'received', 'cancelled', 'rejected', 'DRAFT', 'PENDING', 'COMPLETED', 'CANCELLED')),
      notes TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_transfer_lines (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
      quantity_scaled INTEGER NOT NULL,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_loc ON stock_transfers(source_location_id);
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_dest_loc ON stock_transfers(destination_location_id);
  `);

  // 5. EXTEND STOCK MOVEMENTS
  addColumnIfNotExists(db, 'stock_movements', 'stock_location_id', 'TEXT REFERENCES stock_locations(id) ON DELETE RESTRICT');
  addColumnIfNotExists(db, 'stock_movements', 'transfer_id', 'TEXT REFERENCES stock_transfers(id) ON DELETE SET NULL');

  // 6. SEED DEFAULT STOCK LOCATION & COUNTER LINK FOR DEFAULT BUSINESS
  const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
  const defaultBranchId = '00000000-0000-0000-0000-000000000002';
  const defaultCounterId = '00000000-0000-0000-0000-000000000003';
  const defaultStockLocationId = '00000000-0000-0000-0000-000000000004';

  const defaultBranchExists = db.prepare('SELECT id FROM branches WHERE id = ?').get(defaultBranchId);
  if (defaultBranchExists) {
    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (
        id, business_id, branch_id, name, code, location_type,
        is_default, is_sellable, is_receivable, is_active
      ) VALUES (?, ?, ?, 'Main Store Floor', 'MAIN-FLOOR', 'shop_floor', 1, 1, 1, 1)
    `).run(defaultStockLocationId, defaultBusinessId, defaultBranchId);

    // Link default counter to this default location
    const defaultCounterExists = db.prepare('SELECT id FROM counters WHERE id = ?').get(defaultCounterId);
    if (defaultCounterExists) {
      db.prepare(`
        INSERT OR IGNORE INTO counter_stock_locations (
          id, business_id, counter_id, stock_location_id, is_default
        ) VALUES (?, ?, ?, ?, 1)
      `).run('00000000-0000-0000-0000-000000000005', defaultBusinessId, defaultCounterId, defaultStockLocationId);
    }

    // Populate initial stock_balances for existing products
    const products = db.prepare(`SELECT id, current_stock FROM products WHERE is_active = 1`).all() as Array<{
      id: string | number;
      current_stock: number;
    }>;

    const insertBalance = db.prepare(`
      INSERT OR IGNORE INTO stock_balances (
        id, business_id, product_id, variant_id, stock_location_id,
        on_hand_scaled, reserved_scaled, available_scaled
      ) VALUES (?, ?, ?, NULL, ?, ?, 0, ?)
    `);

    for (const p of products) {
      const scaled = Math.round((p.current_stock || 0) * 1000);
      insertBalance.run(
        `bal-${p.id}-${defaultStockLocationId}`,
        defaultBusinessId,
        String(p.id),
        defaultStockLocationId,
        scaled,
        scaled
      );
    }
  }
}
