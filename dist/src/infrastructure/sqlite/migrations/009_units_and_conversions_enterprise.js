"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV9 = applyMigrationV9;
function addColumnIfNotExists(db, tableName, columnName, columnDef) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = columns.some((c) => c.name.toLowerCase() === columnName.toLowerCase());
    if (!exists) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
    }
}
function applyMigrationV9(db) {
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. UPGRADE UNITS TABLE
        // -----------------------------------------------------------------------
        addColumnIfNotExists(db, 'units', 'business_id', "TEXT DEFAULT '00000000-0000-0000-0000-000000000001'");
        addColumnIfNotExists(db, 'units', 'abbreviation', 'VARCHAR(20)');
        addColumnIfNotExists(db, 'units', 'unit_type', "VARCHAR(30) DEFAULT 'count'");
        addColumnIfNotExists(db, 'units', 'decimal_precision', 'INTEGER DEFAULT 0');
        addColumnIfNotExists(db, 'units', 'is_active', 'BOOLEAN NOT NULL DEFAULT 1');
        addColumnIfNotExists(db, 'units', 'created_at', 'DATETIME');
        addColumnIfNotExists(db, 'units', 'updated_at', 'DATETIME');
        // Sync legacy symbol and dimension to abbreviation and unit_type
        db.prepare(`
      UPDATE units
      SET
        abbreviation = COALESCE(abbreviation, symbol, name),
        unit_type = LOWER(COALESCE(unit_type, dimension, 'count')),
        decimal_precision = COALESCE(decimal_precision, precision_scale, 0),
        is_active = COALESCE(is_active, 1),
        created_at = COALESCE(created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at = COALESCE(updated_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      WHERE abbreviation IS NULL OR abbreviation = '' OR created_at IS NULL
    `).run();
        // Seed default standard retail and enterprise units if missing
        const standardUnits = [
            { name: 'Piece', abbr: 'pcs', type: 'count', precision: 0 },
            { name: 'Pack', abbr: 'pk', type: 'count', precision: 0 },
            { name: 'Dozen', abbr: 'dz', type: 'count', precision: 0 },
            { name: 'Carton', abbr: 'ctn', type: 'count', precision: 0 },
            { name: 'Box', abbr: 'box', type: 'count', precision: 0 },
            { name: 'Kilogram', abbr: 'kg', type: 'weight', precision: 3 },
            { name: 'Gram', abbr: 'g', type: 'weight', precision: 1 },
            { name: 'Litre', abbr: 'L', type: 'volume', precision: 3 },
            { name: 'Millilitre', abbr: 'mL', type: 'volume', precision: 0 },
            { name: 'Metre', abbr: 'm', type: 'length', precision: 2 }
        ];
        const insertOrUpdateUnit = db.prepare(`
      INSERT INTO units (name, symbol, dimension, precision_scale, abbreviation, unit_type, decimal_precision, is_active)
      VALUES (?, ?, UPPER(?), ?, ?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET
        abbreviation = excluded.abbreviation,
        unit_type = excluded.unit_type,
        decimal_precision = excluded.decimal_precision,
        is_active = 1
    `);
        for (const u of standardUnits) {
            insertOrUpdateUnit.run(u.name, u.abbr, u.type, u.precision, u.abbr, u.type, u.precision);
        }
        // -----------------------------------------------------------------------
        // 2. UPGRADE PRODUCT_UNIT_CONVERSIONS TABLE (UUID PK & Enterprise multi-tenant)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_unit_conversions (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        from_unit_id UUID REFERENCES units(id) ON DELETE RESTRICT,
        to_base_factor_numerator BIGINT NOT NULL DEFAULT 1 CHECK(to_base_factor_numerator > 0),
        to_base_factor_denominator BIGINT NOT NULL DEFAULT 1 CHECK(to_base_factor_denominator > 0),
        is_purchase_unit BOOLEAN DEFAULT 0,
        is_sale_unit BOOLEAN DEFAULT 0,
        is_default_purchase_unit BOOLEAN DEFAULT 0,
        is_default_sale_unit BOOLEAN DEFAULT 0,
        barcode VARCHAR(100),
        -- Compatibility columns for legacy queries
        unit_id UUID REFERENCES units(id),
        base_units_numerator BIGINT,
        base_units_denominator BIGINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, unit_id)
      );
      CREATE INDEX IF NOT EXISTS idx_prod_unit_conv_lookup
      ON new_product_unit_conversions(product_id, from_unit_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prod_unit_conv_unit
      ON new_product_unit_conversions(product_id, unit_id);
    `);
        const hasOldConversions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_unit_conversions'").get();
        if (hasOldConversions) {
            const cols = db.prepare("PRAGMA table_info(product_unit_conversions)").all();
            const hasFromUnit = cols.some(c => c.name === 'from_unit_id');
            if (!hasFromUnit) {
                db.prepare(`
          INSERT OR IGNORE INTO new_product_unit_conversions (
            id, business_id, product_id, from_unit_id, unit_id,
            to_base_factor_numerator, to_base_factor_denominator,
            base_units_numerator, base_units_denominator,
            is_purchase_unit, is_sale_unit, is_default_purchase_unit, is_default_sale_unit
          )
          SELECT
            CAST(id AS TEXT), '00000000-0000-0000-0000-000000000001', product_id, unit_id, unit_id,
            base_units_numerator, COALESCE(base_units_denominator, 1),
            base_units_numerator, COALESCE(base_units_denominator, 1),
            1, 1, 0, 0
          FROM product_unit_conversions
        `).run();
                db.exec('DROP TABLE product_unit_conversions;');
                db.exec('ALTER TABLE new_product_unit_conversions RENAME TO product_unit_conversions;');
            }
            else {
                db.exec('DROP TABLE new_product_unit_conversions;');
            }
        }
        else {
            db.exec('ALTER TABLE new_product_unit_conversions RENAME TO product_unit_conversions;');
        }
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_puc_sync_legacy
      AFTER INSERT ON product_unit_conversions
      WHEN NEW.from_unit_id IS NULL AND NEW.unit_id IS NOT NULL
      BEGIN
        UPDATE product_unit_conversions
        SET
          from_unit_id = NEW.unit_id,
          to_base_factor_numerator = COALESCE(NEW.base_units_numerator, 1),
          to_base_factor_denominator = COALESCE(NEW.base_units_denominator, 1)
        WHERE id = NEW.id;
      END;
    `);
        // -----------------------------------------------------------------------
        // 3. HISTORICAL CONVERSION SNAPSHOT COLUMNS ON SALE LINES & PURCHASE LINES
        // -----------------------------------------------------------------------
        addColumnIfNotExists(db, 'sale_lines', 'entered_quantity', 'REAL');
        addColumnIfNotExists(db, 'sale_lines', 'entered_unit_id', 'UUID');
        addColumnIfNotExists(db, 'sale_lines', 'conversion_numerator', 'BIGINT DEFAULT 1');
        addColumnIfNotExists(db, 'sale_lines', 'conversion_denominator', 'BIGINT DEFAULT 1');
        addColumnIfNotExists(db, 'sale_lines', 'base_quantity_scaled', 'BIGINT');
        addColumnIfNotExists(db, 'sale_lines', 'base_unit_price_minor', 'BIGINT');
        const hasPurchaseLines = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_lines'").get();
        if (hasPurchaseLines) {
            addColumnIfNotExists(db, 'purchase_lines', 'entered_quantity', 'REAL');
            addColumnIfNotExists(db, 'purchase_lines', 'entered_unit_id', 'UUID');
            addColumnIfNotExists(db, 'purchase_lines', 'conversion_numerator', 'BIGINT DEFAULT 1');
            addColumnIfNotExists(db, 'purchase_lines', 'conversion_denominator', 'BIGINT DEFAULT 1');
            addColumnIfNotExists(db, 'purchase_lines', 'base_quantity_scaled', 'BIGINT');
            addColumnIfNotExists(db, 'purchase_lines', 'base_unit_cost_minor', 'BIGINT');
        }
        // -----------------------------------------------------------------------
        // 4. RECORD MIGRATION IN SCHEMA_MIGRATIONS
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(9, '009_units_and_conversions_enterprise');
    });
    tx();
}
