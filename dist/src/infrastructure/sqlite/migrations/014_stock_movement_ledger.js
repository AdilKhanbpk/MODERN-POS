"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV14 = applyMigrationV14;
exports.up = up;
function addColumnIfNotExists(db, table, column, typeDef) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef};`);
    }
}
/**
 * Migration 014: Authoritative Stock Movement Ledger (Prompt 12)
 *
 * Implements:
 * 1. stock_movements with UUID PK, positive magnitude, explicit direction, idempotency protection
 * 2. UNIQUE (business_id, idempotency_key) constraint
 * 3. Migration of existing movements with generated UUIDs and normalized direction
 */
function applyMigrationV14(db) {
    const tx = db.transaction(() => {
        up(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(14, '014_stock_movement_ledger');
    });
    tx();
}
function up(db) {
    // Check if stock_movements table exists and check its columns
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_movements'").get();
    if (tableCheck) {
        const cols = db.prepare("PRAGMA table_info('stock_movements')").all();
        const hasIdempotencyKey = cols.some((c) => c.name === 'idempotency_key');
        const isIdText = cols.some((c) => c.name === 'id' && c.type.toUpperCase().includes('TEXT'));
        if (hasIdempotencyKey && isIdText) {
            // Already upgraded
            return;
        }
    }
    // Create new authoritative stock_movements table
    db.exec(`
    CREATE TABLE IF NOT EXISTS new_stock_movements (
      id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
      business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
      branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002' REFERENCES branches(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
      stock_location_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000004' REFERENCES stock_locations(id) ON DELETE RESTRICT,
      batch_id TEXT REFERENCES product_batches(id) ON DELETE RESTRICT,
      serial_number_id TEXT REFERENCES product_serial_numbers(id) ON DELETE RESTRICT,
      movement_type VARCHAR(40) NOT NULL,
      direction VARCHAR(10) NOT NULL DEFAULT 'IN' CHECK(direction IN ('IN', 'OUT')),
      quantity_scaled BIGINT NOT NULL DEFAULT 1 CHECK(quantity_scaled > 0),
      base_unit_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
      unit_precision INTEGER NOT NULL DEFAULT 3,
      unit_cost_minor BIGINT,
      total_cost_minor BIGINT,
      currency_code CHAR(3) DEFAULT 'PKR',
      reference_type VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
      reference_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      reference_line_id TEXT,
      idempotency_key VARCHAR(150) NOT NULL DEFAULT (LOWER(HEX(RANDOMBLOB(16)))),
      payload_hash VARCHAR(64),
      occurred_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      posted_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),

      -- Compatibility columns for legacy code & reports
      location_id INTEGER DEFAULT 1,
      quantity REAL DEFAULT 0,
      previous_stock REAL DEFAULT 0,
      new_stock REAL DEFAULT 0,
      source_type TEXT DEFAULT 'MANUAL',
      source_id INTEGER DEFAULT 0,
      reason TEXT,
      user_id INTEGER,
      transfer_id TEXT,
      serial_id INTEGER,
      quantity_base_scaled REAL DEFAULT 0,

      UNIQUE (business_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_loc
      ON new_stock_movements(business_id, product_id, stock_location_id);

    CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
      ON new_stock_movements(reference_type, reference_id);

    CREATE INDEX IF NOT EXISTS idx_stock_movements_occurred
      ON new_stock_movements(occurred_at);
  `);
    if (tableCheck) {
        // Copy existing records if any
        const existing = db.prepare('SELECT * FROM stock_movements').all();
        const insert = db.prepare(`
      INSERT OR IGNORE INTO new_stock_movements (
        id, business_id, branch_id, product_id, variant_id, stock_location_id,
        movement_type, direction, quantity_scaled, base_unit_id, unit_precision,
        reference_type, reference_id, idempotency_key, occurred_at, posted_at,
        created_at, location_id, quantity, previous_stock, new_stock, reason, user_id
      ) VALUES (
        ?, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
        ?, ?, ?, ?, ?, ?, '00000000-0000-0000-0000-000000000001', 3,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
        for (const row of existing) {
            const type = (row.movement_type || 'SALE').toUpperCase();
            const isOut = type.includes('SALE') ||
                type.includes('TRANSFER_OUT') ||
                type.includes('SUPPLIER_RETURN') ||
                type.includes('DAMAGE') ||
                type.includes('DECREASE');
            const dir = isOut ? 'OUT' : 'IN';
            const absQty = Math.abs(Number(row.quantity_base_scaled || row.quantity || 1));
            const scaled = Math.max(1, Math.round(absQty * 1000));
            const uuid = crypto.randomUUID();
            const locId = row.stock_location_id || '00000000-0000-0000-0000-000000000004';
            const refType = row.reference_type || row.source_type || 'LEGACY';
            const refId = String(row.reference_id || row.source_id || row.id || uuid);
            const idemp = `migrated-${row.id || uuid}`;
            const time = row.created_at || new Date().toISOString();
            try {
                insert.run(uuid, String(row.product_id), row.variant_id ? String(row.variant_id) : null, locId, type, dir, scaled, refType, refId, idemp, time, time, time, row.location_id || 1, absQty, row.previous_stock || 0, row.new_stock || 0, row.reason || null, row.user_id || null);
            }
            catch {
                // Skip duplicate or unparseable row
            }
        }
        db.exec(`DROP TABLE stock_movements;`);
    }
    db.exec(`ALTER TABLE new_stock_movements RENAME TO stock_movements;`);
}
