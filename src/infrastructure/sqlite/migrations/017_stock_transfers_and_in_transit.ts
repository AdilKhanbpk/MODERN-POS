import Database from 'better-sqlite3';

function addColumnIfNotExists(db: Database.Database, table: string, column: string, typeDef: string): void {
  const info = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  if (!info.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
  }
}

/**
 * Migration 017: Multi-Stage Stock Transfers, In-Transit Inventory & Discrepancies (Prompt 15)
 *
 * Implements:
 * 1. Enhances stock_transfers with complete workflow fields: in_transit_location_id,
 *    actors (requested, approved, dispatched, received), timestamps, and idempotency key.
 * 2. Enhances stock_transfer_lines with requested, dispatched, received, rejected, and loss quantities.
 * 3. Creates stock_transfer_receipts and stock_transfer_receipt_lines for partial receipts.
 * 4. Seeds default in-transit location for branch transfers.
 */
export function applyMigrationV17(db: Database.Database): void {
  const tx = db.transaction(() => {
    up(db);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(
      17,
      '017_stock_transfers_and_in_transit'
    );
  });
  tx();
}

export function up(db: Database.Database): void {
  // 1. EXTEND STOCK TRANSFERS TABLE
  addColumnIfNotExists(db, 'stock_transfers', 'in_transit_location_id', 'TEXT REFERENCES stock_locations(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfers', 'requested_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfers', 'approved_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfers', 'dispatched_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfers', 'received_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfers', 'requested_at', 'TEXT');
  addColumnIfNotExists(db, 'stock_transfers', 'approved_at', 'TEXT');
  addColumnIfNotExists(db, 'stock_transfers', 'dispatched_at', 'TEXT');
  addColumnIfNotExists(db, 'stock_transfers', 'received_at', 'TEXT');
  addColumnIfNotExists(db, 'stock_transfers', 'idempotency_key', 'VARCHAR(150)');
  addColumnIfNotExists(db, 'stock_transfers', 'updated_at', "TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))");

  // 2. EXTEND STOCK TRANSFER LINES TABLE
  addColumnIfNotExists(db, 'stock_transfer_lines', 'batch_id', 'TEXT REFERENCES product_batches(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'serial_number_id', 'TEXT REFERENCES product_serial_numbers(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'requested_quantity_scaled', 'BIGINT');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'dispatched_quantity_scaled', 'BIGINT NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'received_quantity_scaled', 'BIGINT NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'rejected_quantity_scaled', 'BIGINT NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'loss_quantity_scaled', 'BIGINT NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'unit_id', 'TEXT REFERENCES units(id) ON DELETE SET NULL');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'unit_cost_minor', 'BIGINT');
  addColumnIfNotExists(db, 'stock_transfer_lines', 'created_at', "TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))");
  addColumnIfNotExists(db, 'stock_transfer_lines', 'updated_at', "TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))");

  // Synchronize requested_quantity_scaled with quantity_scaled for existing rows if needed
  db.exec(`
    UPDATE stock_transfer_lines
    SET requested_quantity_scaled = quantity_scaled
    WHERE requested_quantity_scaled IS NULL AND quantity_scaled IS NOT NULL;
  `);

  // 3. CREATE STOCK TRANSFER RECEIPTS TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transfer_receipts (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      receipt_number VARCHAR(50) NOT NULL,
      received_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      received_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_st_receipts_transfer
      ON stock_transfer_receipts(transfer_id);
  `);

  // 4. CREATE STOCK TRANSFER RECEIPT LINES TABLE
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transfer_receipt_lines (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      receipt_id TEXT NOT NULL REFERENCES stock_transfer_receipts(id) ON DELETE CASCADE,
      transfer_line_id TEXT NOT NULL REFERENCES stock_transfer_lines(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      received_quantity_scaled BIGINT NOT NULL,
      rejected_quantity_scaled BIGINT NOT NULL DEFAULT 0,
      loss_quantity_scaled BIGINT NOT NULL DEFAULT 0,
      rejected_location_id TEXT REFERENCES stock_locations(id) ON DELETE SET NULL,
      discrepancy_reason TEXT,
      discrepancy_action VARCHAR(30),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
    );

    CREATE INDEX IF NOT EXISTS idx_st_receipt_lines_receipt
      ON stock_transfer_receipt_lines(receipt_id);
  `);

  // 5. SEED DEFAULT IN-TRANSIT LOCATION FOR DEFAULT BRANCH
  const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
  const defaultBranchId = '00000000-0000-0000-0000-000000000002';
  const defaultInTransitLocationId = '00000000-0000-0000-0000-000000000099';

  const defaultBranchExists = db.prepare('SELECT id FROM branches WHERE id = ?').get(defaultBranchId);
  if (defaultBranchExists) {
    db.prepare(`
      INSERT OR IGNORE INTO stock_locations (
        id, business_id, branch_id, name, code, location_type,
        is_default, is_sellable, is_receivable, is_active
      ) VALUES (?, ?, ?, 'In-Transit Storage', 'IN-TRANSIT-DEFAULT', 'other', 0, 0, 1, 1)
    `).run(defaultInTransitLocationId, defaultBusinessId, defaultBranchId);
  }
}

