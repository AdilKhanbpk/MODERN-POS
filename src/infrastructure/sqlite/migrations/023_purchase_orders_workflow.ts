import Database from 'better-sqlite3';

export function applyMigrationV23(db: Database.Database): void {
  const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
  const defaultBranchId = '00000000-0000-0000-0000-000000000002';

  db.pragma('legacy_alter_table = ON');
  db.pragma('foreign_keys = OFF');

  const tx = db.transaction(() => {
    // 1. PURCHASE ORDERS (Enterprise upgrade)
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_purchase_orders (
        id UUID PRIMARY KEY,
        business_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002' REFERENCES branches(id) ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        purchase_order_number TEXT NOT NULL DEFAULT ('PO-' || LOWER(HEX(RANDOMBLOB(4)))),
        invoice_number TEXT NULL,
        order_date TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        expected_delivery_date TEXT NULL,
        currency_code TEXT NOT NULL DEFAULT 'PKR',
        exchange_rate_numerator INTEGER NOT NULL DEFAULT 1,
        exchange_rate_denominator INTEGER NOT NULL DEFAULT 1,
        subtotal_minor INTEGER NOT NULL DEFAULT 0,
        discount_minor INTEGER NOT NULL DEFAULT 0,
        tax_minor INTEGER NOT NULL DEFAULT 0,
        shipping_minor INTEGER NOT NULL DEFAULT 0,
        other_charges_minor INTEGER NOT NULL DEFAULT 0,
        total_minor INTEGER NOT NULL DEFAULT 0,
        subtotal INTEGER NOT NULL DEFAULT 0,
        additional_cost INTEGER NOT NULL DEFAULT 0,
        grand_total INTEGER NOT NULL DEFAULT 0,
        amount_paid INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(LOWER(status) IN ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'fully_received', 'partially_invoiced', 'fully_invoiced', 'closed', 'cancelled', 'received')),
        payment_terms_days INTEGER NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_by TEXT NOT NULL DEFAULT '1',
        approved_by TEXT NULL,
        approved_at TEXT NULL,
        sent_at TEXT NULL,
        closed_at TEXT NULL,
        idempotency_key TEXT NOT NULL DEFAULT ('IDEMP-' || LOWER(HEX(RANDOMBLOB(8)))),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id, purchase_order_number),
        UNIQUE(business_id, idempotency_key)
      );
    `);

    const hasOldPo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_orders'").get();
    if (hasOldPo) {
      const cols = db.prepare("PRAGMA table_info(purchase_orders)").all() as Array<{ name: string }>;
      const hasBiz = cols.some((c) => c.name === 'business_id');
      if (!hasBiz) {
        db.prepare(`
          INSERT OR IGNORE INTO new_purchase_orders (
            id, business_id, branch_id, supplier_id, purchase_order_number, invoice_number,
            subtotal_minor, total_minor, subtotal, grand_total, status, notes,
            idempotency_key, created_at, updated_at
          )
          SELECT CAST(id AS TEXT), ?, ?, CAST(supplier_id AS TEXT),
                 COALESCE(invoice_number, 'PO-LEGACY-' || id), invoice_number,
                 subtotal, grand_total, subtotal, grand_total, LOWER(status), notes,
                 'IDEMP-PO-LEGACY-' || id, created_at, created_at
          FROM purchase_orders
        `).run(defaultBusinessId, defaultBranchId);
        db.exec('DROP TABLE purchase_orders;');
        db.exec('ALTER TABLE new_purchase_orders RENAME TO purchase_orders;');
      } else {
        db.exec('DROP TABLE new_purchase_orders;');
      }
    } else {
      db.exec('ALTER TABLE new_purchase_orders RENAME TO purchase_orders;');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_po_biz_num ON purchase_orders(business_id, purchase_order_number);
      CREATE INDEX IF NOT EXISTS idx_po_biz_supp ON purchase_orders(business_id, supplier_id);
      CREATE INDEX IF NOT EXISTS idx_po_biz_status ON purchase_orders(business_id, status);

      CREATE TRIGGER IF NOT EXISTS trg_po_id_default
      AFTER INSERT ON purchase_orders
      FOR EACH ROW
      WHEN NEW.id IS NULL
      BEGIN
        UPDATE purchase_orders SET id = NEW.rowid WHERE rowid = NEW.rowid;
      END;
    `);

    // 2. PURCHASE ORDER LINES
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id TEXT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
        ordered_quantity_scaled INTEGER NOT NULL,
        received_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        invoiced_quantity_scaled INTEGER NOT NULL DEFAULT 0,
        purchase_unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        conversion_numerator INTEGER NOT NULL DEFAULT 1,
        conversion_denominator INTEGER NOT NULL DEFAULT 1,
        base_quantity_scaled INTEGER NOT NULL,
        unit_price_minor INTEGER NOT NULL,
        line_discount_minor INTEGER NOT NULL DEFAULT 0,
        tax_profile_id TEXT NULL,
        tax_minor INTEGER NOT NULL DEFAULT 0,
        line_total_minor INTEGER NOT NULL,
        notes TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id);
      CREATE INDEX IF NOT EXISTS idx_po_lines_prod ON purchase_order_lines(product_id);
    `);

    // 3. PURCHASE ORDER SETTINGS
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_order_settings (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        over_delivery_policy TEXT NOT NULL DEFAULT 'reject' CHECK(over_delivery_policy IN ('reject', 'allow_tolerance', 'require_approval')),
        over_delivery_tolerance_percent REAL NOT NULL DEFAULT 0,
        require_approval_above_minor INTEGER NOT NULL DEFAULT 10000000,
        allow_self_approval INTEGER NOT NULL DEFAULT 0 CHECK(allow_self_approval IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id)
      );
      CREATE INDEX IF NOT EXISTS idx_po_settings_biz ON purchase_order_settings(business_id);
    `);

    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
      VALUES (23, '023_purchase_orders_workflow', DATETIME('now'))
    `).run();
  });

  tx();
  db.pragma('foreign_keys = ON');
}
