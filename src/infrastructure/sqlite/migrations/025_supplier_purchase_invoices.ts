import Database from 'better-sqlite3';

export function applyMigrationV25(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. PURCHASE INVOICES (Header)
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002' REFERENCES branches(id) ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        invoice_number TEXT NOT NULL,
        supplier_invoice_number TEXT NULL,
        invoice_date TEXT NOT NULL,
        due_date TEXT NULL,
        currency_code TEXT NOT NULL DEFAULT 'PKR',
        exchange_rate_numerator INTEGER NOT NULL DEFAULT 1,
        exchange_rate_denominator INTEGER NOT NULL DEFAULT 1,
        subtotal_minor INTEGER NOT NULL DEFAULT 0,
        discount_minor INTEGER NOT NULL DEFAULT 0,
        tax_minor INTEGER NOT NULL DEFAULT 0,
        shipping_minor INTEGER NOT NULL DEFAULT 0,
        other_charges_minor INTEGER NOT NULL DEFAULT 0,
        total_minor INTEGER NOT NULL DEFAULT 0,
        paid_minor INTEGER NOT NULL DEFAULT 0,
        outstanding_minor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(LOWER(status) IN ('draft', 'pending_approval', 'posted', 'partially_paid', 'paid', 'voided')),
        notes TEXT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        posted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        posted_at TEXT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id, invoice_number),
        UNIQUE(business_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_pi_biz_invnum ON purchase_invoices(business_id, invoice_number);
      CREATE INDEX IF NOT EXISTS idx_pi_biz_supplier ON purchase_invoices(business_id, supplier_id);
      CREATE INDEX IF NOT EXISTS idx_pi_biz_status ON purchase_invoices(business_id, status);
      CREATE INDEX IF NOT EXISTS idx_pi_biz_date ON purchase_invoices(business_id, invoice_date);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pi_biz_supp_invnum
      ON purchase_invoices(business_id, supplier_id, supplier_invoice_number)
      WHERE supplier_invoice_number IS NOT NULL AND supplier_invoice_number != '' AND LOWER(status) != 'voided';
    `);

    // 2. PURCHASE INVOICE LINES
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        goods_receipt_line_id TEXT NULL REFERENCES goods_receipt_lines(id) ON DELETE SET NULL,
        purchase_order_line_id TEXT NULL REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id TEXT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
        batch_id TEXT NULL REFERENCES product_batches(id) ON DELETE SET NULL,
        description_snapshot TEXT NULL,
        quantity_scaled INTEGER NOT NULL,
        unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        conversion_numerator INTEGER NOT NULL DEFAULT 1,
        conversion_denominator INTEGER NOT NULL DEFAULT 1,
        unit_price_minor INTEGER NOT NULL DEFAULT 0,
        discount_minor INTEGER NOT NULL DEFAULT 0,
        tax_profile_id TEXT NULL,
        tax_minor INTEGER NOT NULL DEFAULT 0,
        line_total_minor INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_pi_lines_inv ON purchase_invoice_lines(purchase_invoice_id);
      CREATE INDEX IF NOT EXISTS idx_pi_lines_grn ON purchase_invoice_lines(goods_receipt_line_id);
      CREATE INDEX IF NOT EXISTS idx_pi_lines_po ON purchase_invoice_lines(purchase_order_line_id);
      CREATE INDEX IF NOT EXISTS idx_pi_lines_prod ON purchase_invoice_lines(product_id);
    `);

    // 3. PURCHASE INVOICE RECEIPT ALLOCATIONS
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_invoice_receipt_allocations (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        purchase_invoice_line_id TEXT NOT NULL REFERENCES purchase_invoice_lines(id) ON DELETE CASCADE,
        goods_receipt_line_id TEXT NOT NULL REFERENCES goods_receipt_lines(id) ON DELETE CASCADE,
        allocated_quantity_scaled INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );

      CREATE INDEX IF NOT EXISTS idx_pi_alloc_line ON purchase_invoice_receipt_allocations(purchase_invoice_line_id);
      CREATE INDEX IF NOT EXISTS idx_pi_alloc_grn ON purchase_invoice_receipt_allocations(goods_receipt_line_id);
    `);

    // 4. PURCHASE INVOICE SETTINGS
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_invoice_settings (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        duplicate_invoice_policy TEXT NOT NULL DEFAULT 'block' CHECK(duplicate_invoice_policy IN ('block', 'warn', 'allow')),
        price_variance_threshold_minor INTEGER NOT NULL DEFAULT 1000,
        price_variance_threshold_percent REAL NOT NULL DEFAULT 5.0,
        allow_invoice_before_grn INTEGER NOT NULL DEFAULT 0 CHECK(allow_invoice_before_grn IN (0, 1)),
        allow_over_invoicing INTEGER NOT NULL DEFAULT 0 CHECK(allow_over_invoicing IN (0, 1)),
        closed_period_before_date TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pi_settings_biz ON purchase_invoice_settings(business_id);
    `);

    // 5. ACCOUNTING PERIODS
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounting_periods (
        id TEXT PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        period_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0, 1)),
        closed_at TEXT NULL,
        closed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE(business_id, period_name)
      );

      CREATE INDEX IF NOT EXISTS idx_acc_periods_biz ON accounting_periods(business_id, start_date, end_date);
    `);

    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
      VALUES (25, '025_supplier_purchase_invoices', DATETIME('now'))
    `).run();
  });

  tx();
}

