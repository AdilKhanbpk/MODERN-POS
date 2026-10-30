import Database from 'better-sqlite3';

export function applyMigrationV21(db: Database.Database): void {
  const defaultBusinessId = '00000000-0000-0000-0000-000000000001';

  db.pragma('legacy_alter_table = ON');
  db.pragma('foreign_keys = OFF');

  const tx = db.transaction(() => {
    // 1. PRODUCT BATCH SETTINGS
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_batch_settings (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        requires_batch INTEGER NOT NULL DEFAULT 0 CHECK(requires_batch IN (0, 1)),
        requires_expiry INTEGER NOT NULL DEFAULT 0 CHECK(requires_expiry IN (0, 1)),
        expiry_warning_days INTEGER NOT NULL DEFAULT 30,
        expiry_sale_policy TEXT NOT NULL DEFAULT 'block' CHECK(expiry_sale_policy IN ('block', 'warn', 'allow_authorized')),
        batch_cost_policy TEXT NOT NULL DEFAULT 'batch_specific' CHECK(batch_cost_policy IN ('batch_specific', 'fifo', 'average')),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_batch_settings_prod ON product_batch_settings(business_id, product_id);
    `);

    // 2. PRODUCT BATCHES (Enterprise upgrade)
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_batches (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        batch_number TEXT NOT NULL,
        manufacturing_date TEXT NULL,
        expiry_date TEXT NULL,
        supplier_id TEXT NULL REFERENCES suppliers(id) ON DELETE SET NULL,
        purchase_document_line_id TEXT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'quarantine', 'expired', 'recalled', 'closed')),
        cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor >= 0),
        initial_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, product_id, batch_number)
      );
    `);

    const hasOldBatches = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_batches'").get();
    if (hasOldBatches) {
      const cols = db.prepare("PRAGMA table_info(product_batches)").all() as Array<{ name: string }>;
      const hasBiz = cols.some((c) => c.name === 'business_id');
      if (!hasBiz) {
        db.prepare(`
          INSERT OR IGNORE INTO new_product_batches (
            id, business_id, product_id, batch_number, expiry_date, cost_minor, status, created_at, updated_at
          )
          SELECT CAST(id AS TEXT), ?, CAST(product_id AS TEXT), batch_number, expiry_date, cost_minor, 'active', created_at, created_at
          FROM product_batches
        `).run(defaultBusinessId);
        db.exec('DROP TABLE product_batches;');
        db.exec('ALTER TABLE new_product_batches RENAME TO product_batches;');
      } else {
        db.exec('DROP TABLE new_product_batches;');
      }
    } else {
      db.exec('ALTER TABLE new_product_batches RENAME TO product_batches;');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(business_id, product_id);
      CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_batches_status ON product_batches(status);
    `);

    // 3. BATCH STOCK BALANCES
    db.exec(`
      CREATE TABLE IF NOT EXISTS batch_stock_balances (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
        stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
        on_hand_scaled INTEGER NOT NULL DEFAULT 0,
        reserved_scaled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, batch_id, stock_location_id)
      );
      CREATE INDEX IF NOT EXISTS idx_batch_balances ON batch_stock_balances(business_id, batch_id, stock_location_id);
    `);

    // 4. SALE ITEM BATCHES
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_item_batches (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        sale_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        batch_id TEXT NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
        quantity_scaled INTEGER NOT NULL,
        unit_cost_minor INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON sale_item_batches(batch_id);
      CREATE INDEX IF NOT EXISTS idx_sale_item_batches_sale ON sale_item_batches(sale_id);
    `);

    // Record migration
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      21,
      '021_batch_and_expiry_management'
    );
  });

  tx();
  db.pragma('foreign_keys = ON');
}

