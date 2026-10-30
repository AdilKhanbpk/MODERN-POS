import Database from 'better-sqlite3';

export function applyMigrationV22(db: Database.Database): void {
  const defaultBusinessId = '00000000-0000-0000-0000-000000000001';

  db.pragma('legacy_alter_table = ON');
  db.pragma('foreign_keys = OFF');

  const tx = db.transaction(() => {
    // 1. PRODUCT SERIAL SETTINGS
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_serial_settings (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        serial_tracking_required INTEGER NOT NULL DEFAULT 1 CHECK(serial_tracking_required IN (0, 1)),
        serial_format_rule TEXT NULL,
        warranty_default_months INTEGER NULL,
        allow_manual_serial_entry INTEGER NOT NULL DEFAULT 1 CHECK(allow_manual_serial_entry IN (0, 1)),
        warranty_start_trigger TEXT NOT NULL DEFAULT 'on_sale' CHECK(warranty_start_trigger IN ('on_purchase', 'on_delivery', 'on_sale')),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_serial_settings_prod ON product_serial_settings(business_id, product_id);
    `);

    // 2. PRODUCT SERIAL NUMBERS (Upgrade legacy table to enterprise format)
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_serial_numbers (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        serial_number TEXT NOT NULL,
        manufacturer_serial TEXT NULL,
        imei_1 TEXT NULL,
        imei_2 TEXT NULL,
        purchase_document_line_id TEXT NULL,
        supplier_id TEXT NULL REFERENCES suppliers(id) ON DELETE SET NULL,
        current_location_id TEXT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'in_stock' CHECK(status IN ('in_stock', 'reserved', 'sold', 'returned', 'under_repair', 'quarantined', 'written_off')),
        unit_cost_minor INTEGER NULL CHECK(unit_cost_minor IS NULL OR unit_cost_minor >= 0),
        received_at TEXT NULL,
        sold_at TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, product_id, serial_number)
      );
    `);

    const hasOldSerials = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_serial_numbers'").get();
    if (hasOldSerials) {
      const cols = db.prepare("PRAGMA table_info(product_serial_numbers)").all() as Array<{ name: string }>;
      const hasBiz = cols.some((c) => c.name === 'business_id');
      if (!hasBiz) {
        // Migrate legacy rows
        db.prepare(`
          INSERT OR IGNORE INTO new_product_serial_numbers (
            id, business_id, product_id, serial_number, status, created_at, updated_at
          )
          SELECT CAST(id AS TEXT), ?, CAST(product_id AS TEXT), serial_number,
                 CASE WHEN UPPER(status) = 'SOLD' THEN 'sold' ELSE 'in_stock' END,
                 STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
          FROM product_serial_numbers
        `).run(defaultBusinessId);
        db.exec('DROP TABLE product_serial_numbers;');
        db.exec('ALTER TABLE new_product_serial_numbers RENAME TO product_serial_numbers;');
      } else {
        db.exec('DROP TABLE new_product_serial_numbers;');
      }
    } else {
      db.exec('ALTER TABLE new_product_serial_numbers RENAME TO product_serial_numbers;');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_serials_prod ON product_serial_numbers(business_id, product_id);
      CREATE INDEX IF NOT EXISTS idx_serials_sn ON product_serial_numbers(business_id, serial_number);
      CREATE INDEX IF NOT EXISTS idx_serials_imei1 ON product_serial_numbers(business_id, imei_1);
      CREATE INDEX IF NOT EXISTS idx_serials_loc_status ON product_serial_numbers(business_id, current_location_id, status);
    `);

    // 3. SERIAL NUMBER HISTORY
    db.exec(`
      CREATE TABLE IF NOT EXISTS serial_number_history (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        serial_number_id TEXT NOT NULL REFERENCES product_serial_numbers(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        reference_type TEXT NULL,
        reference_id TEXT NULL,
        from_location_id TEXT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        to_location_id TEXT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        from_status TEXT NULL,
        to_status TEXT NULL,
        notes TEXT NULL,
        performed_by TEXT NULL,
        occurred_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_serial_hist_sn ON serial_number_history(serial_number_id);
      CREATE INDEX IF NOT EXISTS idx_serial_hist_biz ON serial_number_history(business_id, occurred_at);
    `);

    // 4. SERIAL WARRANTIES
    db.exec(`
      CREATE TABLE IF NOT EXISTS serial_warranties (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        serial_number_id TEXT NOT NULL REFERENCES product_serial_numbers(id) ON DELETE CASCADE,
        warranty_start_date TEXT NOT NULL,
        warranty_end_date TEXT NULL,
        warranty_provider TEXT NULL,
        warranty_reference TEXT NULL,
        warranty_terms TEXT NULL,
        warranty_trigger TEXT NOT NULL DEFAULT 'on_sale' CHECK(warranty_trigger IN ('on_purchase', 'on_delivery', 'on_sale')),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_serial_warranty_sn ON serial_warranties(serial_number_id);
    `);

    // 5. SALE ITEM SERIALS
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_item_serials (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        sale_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        serial_number_id TEXT NOT NULL REFERENCES product_serial_numbers(id) ON DELETE RESTRICT,
        unit_cost_minor INTEGER NULL,
        warranty_id TEXT NULL REFERENCES serial_warranties(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_sale_item_serials_sale ON sale_item_serials(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_item_serials_sn ON sale_item_serials(serial_number_id);
    `);

    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
      VALUES (22, '022_serial_number_tracking', DATETIME('now'))
    `).run();
  });

  tx();
  db.pragma('foreign_keys = ON');
}

