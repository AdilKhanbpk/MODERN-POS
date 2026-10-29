import Database from 'better-sqlite3';

export function applyMigrationV10(db: Database.Database): void {
  const tx = db.transaction(() => {
    // -----------------------------------------------------------------------
    // 1. UPGRADE PRODUCT_BARCODES (UUID PK, Multi-Tenant, Unit Conversion FK)
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_barcodes (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        product_unit_conversion_id UUID REFERENCES product_unit_conversions(id) ON DELETE SET NULL,
        barcode_value VARCHAR(150) NOT NULL DEFAULT '',
        barcode_type VARCHAR(30) NOT NULL DEFAULT 'EAN13',
        is_primary BOOLEAN NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        -- Compatibility columns for legacy repositories
        barcode VARCHAR(150),
        unit_id UUID REFERENCES units(id),
        variant_id UUID REFERENCES product_variants(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_barcodes_biz_val_active
      ON new_product_barcodes(business_id, barcode_value) WHERE is_active = 1;

      CREATE INDEX IF NOT EXISTS idx_barcodes_prod_active
      ON new_product_barcodes(product_id, is_active);

      CREATE INDEX IF NOT EXISTS idx_barcodes_val
      ON new_product_barcodes(barcode_value);
    `);

    const hasOldBarcodes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_barcodes'").get();
    if (hasOldBarcodes) {
      const cols = db.prepare("PRAGMA table_info(product_barcodes)").all() as Array<{ name: string }>;
      const hasBarcodeValue = cols.some(c => c.name === 'barcode_value');
      if (!hasBarcodeValue) {
        db.prepare(`
          INSERT OR IGNORE INTO new_product_barcodes (
            id, business_id, product_id, barcode_value, barcode_type,
            is_primary, is_active, barcode, unit_id, variant_id
          )
          SELECT
            CAST(id AS TEXT),
            '00000000-0000-0000-0000-000000000001',
            product_id,
            barcode,
            'EAN13',
            0,
            1,
            barcode,
            unit_id,
            variant_id
          FROM product_barcodes
        `).run();

        db.exec('DROP TABLE product_barcodes;');
        db.exec('ALTER TABLE new_product_barcodes RENAME TO product_barcodes;');
      } else {
        db.exec('DROP TABLE new_product_barcodes;');
      }
    } else {
      db.exec('ALTER TABLE new_product_barcodes RENAME TO product_barcodes;');
    }

    // Trigger to keep legacy 'barcode' column in sync with 'barcode_value'
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_barcodes_sync_val_insert
      AFTER INSERT ON product_barcodes
      WHEN (NEW.barcode IS NULL OR NEW.barcode = '') AND NEW.barcode_value IS NOT NULL AND NEW.barcode_value != ''
      BEGIN
        UPDATE product_barcodes SET barcode = NEW.barcode_value WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_barcodes_sync_val_legacy_insert
      AFTER INSERT ON product_barcodes
      WHEN (NEW.barcode_value IS NULL OR NEW.barcode_value = '') AND NEW.barcode IS NOT NULL AND NEW.barcode != ''
      BEGIN
        UPDATE product_barcodes SET barcode_value = NEW.barcode WHERE id = NEW.id;
      END;
    `);

    // -----------------------------------------------------------------------
    // 2. SCALE_BARCODE_PROFILES TABLE
    // -----------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS scale_barcode_profiles (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        prefix VARCHAR(30) NOT NULL,
        total_length INTEGER NOT NULL,
        product_code_start INTEGER NOT NULL,
        product_code_length INTEGER NOT NULL,
        value_start INTEGER NOT NULL,
        value_length INTEGER NOT NULL,
        value_type VARCHAR(20) NOT NULL CHECK(value_type IN ('weight', 'price')),
        decimal_places INTEGER NOT NULL DEFAULT 3,
        check_digit_rule VARCHAR(50) DEFAULT 'EAN13_MOD10',
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_scale_profiles_biz
      ON scale_barcode_profiles(business_id, is_active);
    `);

    // Seed default standard retail scale profile: EAN-13 Weight (Prefix 20, 5-digit PLU, 5-digit Weight in grams, 1 check digit)
    const defaultProfileExists = db.prepare(`
      SELECT id FROM scale_barcode_profiles
      WHERE business_id = '00000000-0000-0000-0000-000000000001' AND prefix = '20'
    `).get();

    if (!defaultProfileExists) {
      db.prepare(`
        INSERT INTO scale_barcode_profiles (
          id, business_id, name, prefix, total_length,
          product_code_start, product_code_length,
          value_start, value_length, value_type, decimal_places,
          check_digit_rule, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        '00000000-0000-0000-0000-000000000080',
        '00000000-0000-0000-0000-000000000001',
        'Standard Supermarket Scale (EAN-13 Weight)',
        '20',
        13, // 2 (prefix) + 5 (PLU) + 5 (weight) + 1 (checksum)
        2,  // 0-based index: chars 2-6 (length 5)
        5,
        7,  // 0-based index: chars 7-11 (length 5)
        5,
        'weight',
        3,  // 3 decimals: e.g. 01250 -> 1.250 kg
        'EAN13_MOD10'
      );
    }

    // -----------------------------------------------------------------------
    // 3. RECORD SCHEMA MIGRATION V10
    // -----------------------------------------------------------------------
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      10,
      '010_barcodes_and_scale_profiles'
    );
  });

  tx();
}

