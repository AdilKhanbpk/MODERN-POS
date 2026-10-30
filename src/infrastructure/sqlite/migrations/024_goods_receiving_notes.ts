import Database from 'better-sqlite3';

export function applyMigrationV24(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. GOODS RECEIPTS (Header)
    db.exec(`
      CREATE TABLE IF NOT EXISTS goods_receipts (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002' REFERENCES branches(id) ON DELETE RESTRICT,
        purchase_order_id TEXT NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        receipt_number TEXT NOT NULL,
        supplier_delivery_note TEXT NULL,
        received_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(LOWER(status) IN ('draft', 'pending_inspection', 'pending_approval', 'approved', 'posted', 'cancelled')),
        notes TEXT NULL,
        received_by TEXT NOT NULL DEFAULT '1',
        approved_by TEXT NULL,
        approved_at TEXT NULL,
        posted_by TEXT NULL,
        posted_at TEXT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id, receipt_number),
        UNIQUE(business_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_grn_biz_num ON goods_receipts(business_id, receipt_number);
      CREATE INDEX IF NOT EXISTS idx_grn_biz_supp ON goods_receipts(business_id, supplier_id);
      CREATE INDEX IF NOT EXISTS idx_grn_biz_po ON goods_receipts(business_id, purchase_order_id);
      CREATE INDEX IF NOT EXISTS idx_grn_biz_status ON goods_receipts(business_id, status);
    `);

    // 2. GOODS RECEIPT LINES
    db.exec(`
      CREATE TABLE IF NOT EXISTS goods_receipt_lines (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
        purchase_order_line_id TEXT NULL REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id TEXT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
        batch_id TEXT NULL REFERENCES product_batches(id) ON DELETE SET NULL,
        batch_number TEXT NULL,
        expiry_date TEXT NULL,
        manufacturing_date TEXT NULL,
        purchase_unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        conversion_numerator INTEGER NOT NULL DEFAULT 1,
        conversion_denominator INTEGER NOT NULL DEFAULT 1,
        received_quantity_scaled INTEGER NOT NULL,
        accepted_quantity_scaled INTEGER NOT NULL,
        rejected_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        damaged_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        base_accepted_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        base_damaged_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        base_rejected_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        unit_cost_minor INTEGER NULL,
        discrepancy_type TEXT NULL,
        discrepancy_reason TEXT NULL,
        notes TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );

      CREATE INDEX IF NOT EXISTS idx_grn_lines_grn ON goods_receipt_lines(goods_receipt_id);
      CREATE INDEX IF NOT EXISTS idx_grn_lines_prod ON goods_receipt_lines(product_id);
      CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line ON goods_receipt_lines(purchase_order_line_id);
    `);

    // 3. GOODS RECEIPT SERIALS
    db.exec(`
      CREATE TABLE IF NOT EXISTS goods_receipt_serials (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
        goods_receipt_line_id TEXT NOT NULL REFERENCES goods_receipt_lines(id) ON DELETE CASCADE,
        serial_number_id TEXT NULL REFERENCES product_serial_numbers(id) ON DELETE SET NULL,
        serial_number TEXT NOT NULL,
        manufacturer_serial TEXT NULL,
        imei_1 TEXT NULL,
        imei_2 TEXT NULL,
        condition TEXT NOT NULL DEFAULT 'accepted' CHECK(condition IN ('accepted', 'rejected', 'damaged', 'quarantined')),
        notes TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );

      CREATE INDEX IF NOT EXISTS idx_grn_serials_line ON goods_receipt_serials(goods_receipt_line_id);
    `);

    const hasLinesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='goods_receipt_lines'").get();
    if (hasLinesTable) {
      const lineCols = db.prepare("PRAGMA table_info('goods_receipt_lines')").all() as Array<{ name: string }>;
      if (!lineCols.some((c) => c.name === 'batch_number')) {
        db.exec("ALTER TABLE goods_receipt_lines ADD COLUMN batch_number TEXT NULL;");
        db.exec("ALTER TABLE goods_receipt_lines ADD COLUMN expiry_date TEXT NULL;");
        db.exec("ALTER TABLE goods_receipt_lines ADD COLUMN manufacturing_date TEXT NULL;");
      }
    }

    // 4. GOODS RECEIPT SETTINGS
    db.exec(`
      CREATE TABLE IF NOT EXISTS goods_receipt_settings (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        allow_direct_receipt INTEGER NOT NULL DEFAULT 1 CHECK(allow_direct_receipt IN (0, 1)),
        require_inspection INTEGER NOT NULL DEFAULT 0 CHECK(require_inspection IN (0, 1)),
        quarantine_location_id TEXT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        damaged_location_id TEXT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        over_delivery_policy TEXT NOT NULL DEFAULT 'reject' CHECK(over_delivery_policy IN ('reject', 'allow_tolerance', 'require_approval')),
        over_delivery_tolerance_percent REAL NOT NULL DEFAULT 0,
        provisional_cost_policy TEXT NOT NULL DEFAULT 'last_purchase_price' CHECK(provisional_cost_policy IN ('last_purchase_price', 'product_cost', 'zero', 'require_manual')),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id)
      );

      CREATE INDEX IF NOT EXISTS idx_grn_settings_biz ON goods_receipt_settings(business_id);
    `);

    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
      VALUES (24, '024_goods_receiving_notes', DATETIME('now'))
    `).run();
  });

  tx();
}
