import Database from 'better-sqlite3';

/**
 * Migration 019: Stock Reservations System
 * Prompt 17 Implementation
 */
export function applyMigrationV19(db: Database.Database): void {
  const tx = db.transaction(() => {
    up(db);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      19,
      '019_stock_reservations'
    );
  });
  tx();
}

export function up(db: Database.Database): void {
  // 1. CREATE STOCK RESERVATIONS TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_reservations (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      reservation_number VARCHAR(50) NOT NULL UNIQUE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      source_type VARCHAR(40) NOT NULL CHECK(source_type IN ('quotation', 'sales_order', 'manual', 'other')),
      source_id TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'partially_fulfilled', 'fulfilled', 'expired', 'cancelled')),
      reserved_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      expires_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_business_status
      ON stock_reservations(business_id, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_expires_at
      ON stock_reservations(expires_at, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_customer
      ON stock_reservations(customer_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_branch
      ON stock_reservations(branch_id);
  `);

  // 2. CREATE STOCK RESERVATION LINES TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_reservation_lines (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      reservation_id TEXT NOT NULL REFERENCES stock_reservations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      batch_id TEXT REFERENCES product_batches(id) ON DELETE SET NULL,
      reserved_quantity_scaled BIGINT NOT NULL CHECK(reserved_quantity_scaled > 0),
      fulfilled_quantity_scaled BIGINT NOT NULL DEFAULT 0 CHECK(fulfilled_quantity_scaled >= 0),
      released_quantity_scaled BIGINT NOT NULL DEFAULT 0 CHECK(released_quantity_scaled >= 0),
      unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_reservation_lines_reservation
      ON stock_reservation_lines(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_reservation_lines_prod_loc
      ON stock_reservation_lines(product_id, stock_location_id);
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS stock_reservation_lines;`);
  db.exec(`DROP TABLE IF EXISTS stock_reservations;`);
  db.prepare('DELETE FROM schema_migrations WHERE version = 19').run();
}
