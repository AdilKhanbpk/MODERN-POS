import Database from 'better-sqlite3';

function addColumnIfNotExists(db: Database.Database, table: string, column: string, colDefinition: string): void {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = pragma.some(c => c.name.toLowerCase() === column.toLowerCase());
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDefinition};`);
  }
}

export function applyMigrationV3(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Seed complete retail units from Part 3 specification
    const defaultUnits = [
      { name: 'Piece', symbol: 'pcs', dimension: 'COUNT', scale: 0 },
      { name: 'Pair', symbol: 'pr', dimension: 'COUNT', scale: 0 },
      { name: 'Dozen', symbol: 'doz', dimension: 'COUNT', scale: 0 },
      { name: 'Gross', symbol: 'gr', dimension: 'COUNT', scale: 0 },
      { name: 'Pack', symbol: 'pk', dimension: 'COUNT', scale: 0 },
      { name: 'Box', symbol: 'bx', dimension: 'COUNT', scale: 0 },
      { name: 'Carton', symbol: 'ctn', dimension: 'COUNT', scale: 0 },
      { name: 'Kilogram', symbol: 'kg', dimension: 'WEIGHT', scale: 3 },
      { name: 'Gram', symbol: 'g', dimension: 'WEIGHT', scale: 3 },
      { name: 'Litre', symbol: 'ltr', dimension: 'VOLUME', scale: 3 },
      { name: 'Millilitre', symbol: 'ml', dimension: 'VOLUME', scale: 3 },
      { name: 'Metre', symbol: 'm', dimension: 'LENGTH', scale: 2 },
      { name: 'Centimetre', symbol: 'cm', dimension: 'LENGTH', scale: 1 }
    ];

    const insertUnit = db.prepare(`
      INSERT INTO units (name, symbol, dimension, precision_scale)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        symbol = excluded.symbol,
        dimension = excluded.dimension,
        precision_scale = excluded.precision_scale
    `);
    for (const u of defaultUnits) {
      insertUnit.run(u.name, u.symbol, u.dimension, u.scale);
    }

    // 2. Add complete historical snapshot columns to sale_lines
    addColumnIfNotExists(db, 'sale_lines', 'allocated_bill_discount_minor', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'sale_lines', 'tax_rate', 'REAL NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'sale_lines', 'is_tax_inclusive', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'sale_lines', 'line_profit_minor', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'sale_lines', 'unit_name_snapshot', "TEXT DEFAULT 'Piece'");
    addColumnIfNotExists(db, 'sale_lines', 'conversion_numerator_snapshot', 'INTEGER DEFAULT 1');
    addColumnIfNotExists(db, 'sale_lines', 'conversion_denominator_snapshot', 'INTEGER DEFAULT 1');

    // 3. Ensure business_settings has PKR defaults
    db.prepare(`
      UPDATE business_settings
      SET currency_code = 'PKR', currency_precision = 2
      WHERE id = 1 AND (currency_code IS NULL OR currency_code = '')
    `).run();

    // 4. Record migration in schema_migrations
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      3,
      '003_part3_scale_snapshots'
    );
  });

  tx();
}

