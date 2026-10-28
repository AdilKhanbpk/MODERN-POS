import Database from 'better-sqlite3';

function addColumnIfNotExists(db: Database.Database, table: string, column: string, columnDef: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef};`);
  }
}

export function applyMigrationV2(db: Database.Database): void {
  const transaction = db.transaction(() => {
    // -------------------------------------------------------------
    // GROUP A: Business Settings & Security
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS business_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        logo_path TEXT,
        currency_code TEXT NOT NULL DEFAULT 'PKR',
        currency_precision INTEGER NOT NULL DEFAULT 2,
        timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        permission_key TEXT NOT NULL UNIQUE,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
        PRIMARY KEY (user_id, role_id)
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );

      CREATE TABLE IF NOT EXISTS document_sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_type TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        next_number INTEGER NOT NULL DEFAULT 1
      );
    `);

    // -------------------------------------------------------------
    // GROUP B: Categories, Products, Variants & Units
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

      CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        dimension TEXT NOT NULL DEFAULT 'COUNT' CHECK(dimension IN ('COUNT', 'WEIGHT', 'VOLUME', 'LENGTH')),
        precision_scale INTEGER NOT NULL DEFAULT 0 CHECK(precision_scale >= 0)
      );
      INSERT OR IGNORE INTO units (id, name, symbol, dimension, precision_scale) VALUES (1, 'Piece', 'pcs', 'COUNT', 0);
    `);

    // Add enterprise columns to products table if missing
    addColumnIfNotExists(db, 'products', 'brand_id', 'INTEGER REFERENCES brands(id) ON DELETE RESTRICT');
    addColumnIfNotExists(db, 'products', 'base_unit_id', 'INTEGER REFERENCES units(id) ON DELETE RESTRICT');
    db.exec('UPDATE products SET base_unit_id = 1 WHERE base_unit_id IS NULL;');
    addColumnIfNotExists(db, 'products', 'default_cost_minor', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'products', 'default_sale_price_minor', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'products', 'reorder_level_scaled', 'REAL NOT NULL DEFAULT 5');
    addColumnIfNotExists(db, 'products', 'tracking_mode', "TEXT NOT NULL DEFAULT 'STANDARD' CHECK(tracking_mode IN ('STANDARD', 'BATCH', 'SERIAL'))");

    // Sync cost_price and selling_price to default_*_minor if default is 0
    db.exec(`
      UPDATE products
      SET default_cost_minor = cost_price, default_sale_price_minor = selling_price, reorder_level_scaled = min_stock_level
      WHERE default_sale_price_minor = 0 AND selling_price > 0;
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_sku TEXT NOT NULL UNIQUE,
        size TEXT,
        color TEXT,
        model TEXT,
        cost_minor INTEGER,
        price_minor INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS idx_variant_sku ON product_variants(variant_sku);
      CREATE INDEX IF NOT EXISTS idx_variant_product ON product_variants(product_id);

      CREATE TABLE IF NOT EXISTS product_barcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
        barcode TEXT NOT NULL UNIQUE,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_barcodes_code ON product_barcodes(barcode);

      CREATE TABLE IF NOT EXISTS product_unit_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        base_units_numerator INTEGER NOT NULL CHECK(base_units_numerator > 0),
        base_units_denominator INTEGER NOT NULL DEFAULT 1 CHECK(base_units_denominator > 0),
        UNIQUE (product_id, unit_id)
      );

      CREATE TABLE IF NOT EXISTS product_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        price_type TEXT NOT NULL DEFAULT 'RETAIL' CHECK(price_type IN ('RETAIL', 'WHOLESALE', 'SPECIAL')),
        price_minor INTEGER NOT NULL CHECK(price_minor >= 0),
        UNIQUE (product_id, variant_id, unit_id, price_type)
      );

      CREATE TABLE IF NOT EXISTS product_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        batch_number TEXT NOT NULL,
        expiry_date DATE,
        cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor >= 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product_id, batch_number)
      );
      CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);

      CREATE TABLE IF NOT EXISTS product_serial_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        serial_number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD', 'DEFECTIVE', 'RETURNED_TO_SUPPLIER', 'UNDER_WARRANTY'))
      );
      CREATE INDEX IF NOT EXISTS idx_serials_number ON product_serial_numbers(serial_number);
    `);

    // -------------------------------------------------------------
    // GROUP C: Inventory & Stock Ledger
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS registers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        UNIQUE (location_id, name)
      );

      INSERT OR IGNORE INTO locations (id, name, is_active) VALUES (1, 'Main Retail Store', 1);
      INSERT OR IGNORE INTO registers (id, location_id, name, is_active) VALUES (1, 1, 'Counter 01 - Cash Register', 1);

      CREATE TABLE IF NOT EXISTS stock_balances (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER NOT NULL DEFAULT 0,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        batch_id INTEGER NOT NULL DEFAULT 0,
        quantity_base_scaled REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (product_id, variant_id, location_id, batch_id)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_balances_loc ON stock_balances(location_id, product_id);

      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_number TEXT NOT NULL UNIQUE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'APPROVED', 'CANCELLED')),
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        system_qty_scaled REAL NOT NULL,
        counted_qty_scaled REAL NOT NULL,
        difference_qty_scaled REAL NOT NULL
      );
    `);

    // Add variant_id, location_id, batch_id, serial_id to stock_movements if missing
    addColumnIfNotExists(db, 'stock_movements', 'variant_id', 'INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT');
    addColumnIfNotExists(db, 'stock_movements', 'location_id', 'INTEGER REFERENCES locations(id) ON DELETE RESTRICT');
    db.exec('UPDATE stock_movements SET location_id = 1 WHERE location_id IS NULL;');
    addColumnIfNotExists(db, 'stock_movements', 'batch_id', 'INTEGER REFERENCES product_batches(id) ON DELETE RESTRICT');
    addColumnIfNotExists(db, 'stock_movements', 'serial_id', 'INTEGER REFERENCES product_serial_numbers(id) ON DELETE RESTRICT');
    addColumnIfNotExists(db, 'stock_movements', 'quantity_base_scaled', 'REAL');
    addColumnIfNotExists(db, 'stock_movements', 'source_type', "TEXT DEFAULT 'MANUAL'");
    addColumnIfNotExists(db, 'stock_movements', 'source_id', 'INTEGER DEFAULT 0');

    db.exec(`
      UPDATE stock_movements
      SET quantity_base_scaled = quantity
      WHERE quantity_base_scaled IS NULL AND quantity IS NOT NULL;

      UPDATE stock_movements
      SET source_type = COALESCE(reference_type, 'MANUAL'),
          source_id = COALESCE(reference_id, 0)
      WHERE source_type IS NULL OR source_type = 'MANUAL';
    `);

    // -------------------------------------------------------------
    // GROUP D: Customers, Suppliers & Companies
    // -------------------------------------------------------------

    addColumnIfNotExists(db, 'customers', 'customer_code', "TEXT");
    addColumnIfNotExists(db, 'customers', 'credit_limit_minor', 'INTEGER NOT NULL DEFAULT 0');
    db.exec(`UPDATE customers SET customer_code = 'CUST-' || PRINTF('%04d', id) WHERE customer_code IS NULL;`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);`);

    db.exec(`
      UPDATE customers
      SET credit_limit_minor = credit_limit
      WHERE credit_limit_minor = 0 AND credit_limit > 0;
    `);

    addColumnIfNotExists(db, 'suppliers', 'supplier_code', "TEXT");
    db.exec(`UPDATE suppliers SET supplier_code = 'SUP-' || PRINTF('%04d', id) WHERE supplier_code IS NULL;`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        company_type TEXT NOT NULL CHECK(company_type IN ('MANUFACTURER', 'DISTRIBUTOR', 'WARRANTY_PROVIDER')),
        phone TEXT,
        address TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customer_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK(entry_type IN ('OPENING_BALANCE', 'SALE_INVOICE', 'PAYMENT_RECEIVED', 'SALE_RETURN', 'ADJUSTMENT')),
        debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
        credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
        source_type TEXT NOT NULL,
        source_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cle_customer ON customer_ledger_entries(customer_id, created_at);

      CREATE TABLE IF NOT EXISTS supplier_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK(entry_type IN ('OPENING_BALANCE', 'PURCHASE_BILL', 'PAYMENT_DISBURSED', 'PURCHASE_RETURN', 'ADJUSTMENT')),
        debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
        credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
        source_type TEXT NOT NULL,
        source_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sle_supplier ON supplier_ledger_entries(supplier_id, created_at);
    `);

    // -------------------------------------------------------------
    // GROUP E: Sales, Purchases, Returns & Historical Snapshots
    // -------------------------------------------------------------

    addColumnIfNotExists(db, 'sales', 'location_id', 'INTEGER REFERENCES locations(id) ON DELETE RESTRICT');
    db.exec('UPDATE sales SET location_id = 1 WHERE location_id IS NULL;');
    addColumnIfNotExists(db, 'sales', 'register_id', 'INTEGER REFERENCES registers(id) ON DELETE RESTRICT');
    db.exec('UPDATE sales SET register_id = 1 WHERE register_id IS NULL;');
    addColumnIfNotExists(db, 'sales', 'subtotal_minor', 'INTEGER');
    addColumnIfNotExists(db, 'sales', 'discount_minor', 'INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'sales', 'tax_minor', 'INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'sales', 'total_minor', 'INTEGER');
    addColumnIfNotExists(db, 'sales', 'total_cost_minor', 'INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'sales', 'profit_minor', 'INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'sales', 'created_by', 'INTEGER REFERENCES users(id) ON DELETE RESTRICT');
    db.exec('UPDATE sales SET created_by = cashier_id WHERE created_by IS NULL;');

    db.exec(`
      UPDATE sales
      SET subtotal_minor = subtotal,
          discount_minor = total_discount,
          tax_minor = total_tax,
          total_minor = grand_total,
          total_cost_minor = total_cost,
          profit_minor = profit,
          created_by = cashier_id
      WHERE total_minor IS NULL AND grand_total IS NOT NULL;
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT NOT NULL,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        quantity_scaled REAL NOT NULL CHECK(quantity_scaled > 0),
        unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
        discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
        tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
        unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_lines_product ON sale_lines(product_id);

      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_number TEXT NOT NULL UNIQUE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        supplier_invoice_number TEXT,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('DRAFT', 'POSTED', 'CANCELLED')),
        subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
        additional_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(additional_cost_minor >= 0),
        total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_purchases_number ON purchases(purchase_number);

      CREATE TABLE IF NOT EXISTS purchase_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        quantity_scaled REAL NOT NULL CHECK(quantity_scaled > 0),
        unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0),
        discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
        tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_lines_po ON purchase_lines(purchase_id);

      CREATE TABLE IF NOT EXISTS sale_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_number TEXT NOT NULL UNIQUE,
        original_sale_id INTEGER REFERENCES sales(id) ON DELETE RESTRICT,
        customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED', 'VOIDED')),
        refund_minor INTEGER NOT NULL CHECK(refund_minor >= 0),
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sale_return_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE RESTRICT,
        original_sale_line_id INTEGER REFERENCES sale_lines(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        quantity_scaled REAL NOT NULL CHECK(quantity_scaled > 0),
        disposition TEXT NOT NULL CHECK(disposition IN ('RETURN_TO_STOCK', 'DAMAGED_WRITE_OFF', 'WARRANTY_REPAIR')),
        refund_minor INTEGER NOT NULL CHECK(refund_minor >= 0)
      );

      CREATE TABLE IF NOT EXISTS supplier_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_number TEXT NOT NULL UNIQUE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        original_purchase_id INTEGER REFERENCES purchases(id) ON DELETE RESTRICT,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED', 'VOIDED')),
        reason TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS supplier_return_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        quantity_scaled REAL NOT NULL CHECK(quantity_scaled > 0),
        cost_minor INTEGER NOT NULL CHECK(cost_minor >= 0)
      );
    `);

    // -------------------------------------------------------------
    // GROUP F: Payments & Payment Allocations
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        method_type TEXT NOT NULL CHECK(method_type IN ('CASH', 'BANK', 'DIGITAL_WALLET', 'OTHER')),
        affects_cash_drawer INTEGER NOT NULL DEFAULT 0 CHECK(affects_cash_drawer IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS cash_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        register_id INTEGER NOT NULL REFERENCES registers(id) ON DELETE RESTRICT,
        opened_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        opening_cash_minor INTEGER NOT NULL DEFAULT 0 CHECK(opening_cash_minor >= 0),
        closed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        expected_cash_minor INTEGER,
        counted_cash_minor INTEGER,
        difference_minor INTEGER,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSED')),
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_number TEXT NOT NULL UNIQUE,
        party_type TEXT NOT NULL CHECK(party_type IN ('CUSTOMER', 'SUPPLIER', 'OTHER')),
        party_id INTEGER,
        direction TEXT NOT NULL CHECK(direction IN ('INBOUND', 'OUTBOUND')),
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
        cash_session_id INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED', 'VOIDED')),
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_type, party_id);

      CREATE TABLE IF NOT EXISTS payment_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
        document_type TEXT NOT NULL CHECK(document_type IN ('SALE', 'PURCHASE', 'SALE_RETURN', 'SUPPLIER_RETURN', 'ADVANCE')),
        document_id INTEGER NOT NULL,
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS idx_allocations_doc ON payment_allocations(document_type, document_id);

      CREATE TABLE IF NOT EXISTS cash_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK(movement_type IN ('OPENING_FLOAT', 'CASH_SALE', 'CASH_SALE_REFUND', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE_PAYOUT', 'CASH_IN', 'CASH_OUT')),
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        direction TEXT NOT NULL CHECK(direction IN ('IN', 'OUT')),
        source_type TEXT NOT NULL,
        source_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id);
    `);

    // -------------------------------------------------------------
    // GROUP G: Expenses, Employees & Salary Obligations
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS salary_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0),
        deductions_minor INTEGER NOT NULL DEFAULT 0 CHECK(deductions_minor >= 0),
        net_minor INTEGER NOT NULL CHECK(net_minor >= 0),
        status TEXT NOT NULL DEFAULT 'CALCULATED' CHECK(status IN ('CALCULATED', 'PARTIALLY_PAID', 'PAID')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, period_start, period_end)
      );

      CREATE TABLE IF NOT EXISTS salary_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salary_entry_id INTEGER NOT NULL REFERENCES salary_entries(id) ON DELETE RESTRICT,
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -------------------------------------------------------------
    // GROUP H: Warranty & Repaired Items
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS warranty_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_number TEXT NOT NULL UNIQUE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
        serial_id INTEGER REFERENCES product_serial_numbers(id) ON DELETE RESTRICT,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
        company_id INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
        customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
        issue_description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED', 'DISPATCHED_TO_COMPANY', 'RETURNED_FROM_COMPANY', 'DELIVERED_TO_CUSTOMER', 'REJECTED')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS warranty_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warranty_case_id INTEGER NOT NULL REFERENCES warranty_cases(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK(movement_type IN ('INTAKE', 'DISPATCH', 'REPAIR_RECEIPT', 'CUSTOMER_DELIVERY', 'SCRAPPED')),
        quantity_scaled REAL NOT NULL DEFAULT 1,
        serial_id INTEGER REFERENCES product_serial_numbers(id) ON DELETE RESTRICT,
        source_document_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -------------------------------------------------------------
    // GROUP I: Backup & Operation History
    // -------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_path TEXT NOT NULL,
        checksum TEXT,
        status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED')),
        size_bytes INTEGER NOT NULL DEFAULT 0,
        verification_result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        response_payload TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -------------------------------------------------------------
    // SEED INITIAL REFERENCE DATA
    // -------------------------------------------------------------

    const docTypes = [
      { type: 'SALE', prefix: 'INV', next: 1001 },
      { type: 'PURCHASE', prefix: 'PO', next: 2001 },
      { type: 'PAYMENT', prefix: 'PAY', next: 3001 },
      { type: 'ADJUSTMENT', prefix: 'ADJ', next: 4001 },
      { type: 'SALE_RETURN', prefix: 'SRN', next: 5001 },
      { type: 'SUPPLIER_RETURN', prefix: 'PRN', next: 6001 },
      { type: 'WARRANTY', prefix: 'WAR', next: 7001 },
      { type: 'EXPENSE', prefix: 'EXP', next: 8001 }
    ];

    const insertDocSeq = db.prepare(`
      INSERT OR IGNORE INTO document_sequences (document_type, prefix, next_number)
      VALUES (?, ?, ?)
    `);
    for (const d of docTypes) {
      insertDocSeq.run(d.type, d.prefix, d.next);
    }

    const defaultUnits = [
      { id: 1, name: 'Piece', symbol: 'pcs', dimension: 'COUNT', scale: 0 },
      { id: 2, name: 'Dozen', symbol: 'doz', dimension: 'COUNT', scale: 0 },
      { id: 3, name: 'Pack', symbol: 'pk', dimension: 'COUNT', scale: 0 },
      { id: 4, name: 'Carton', symbol: 'ctn', dimension: 'COUNT', scale: 0 },
      { id: 5, name: 'Kilogram', symbol: 'kg', dimension: 'WEIGHT', scale: 3 },
      { id: 6, name: 'Gram', symbol: 'g', dimension: 'WEIGHT', scale: 3 },
      { id: 7, name: 'Litre', symbol: 'ltr', dimension: 'VOLUME', scale: 3 },
      { id: 8, name: 'Millilitre', symbol: 'ml', dimension: 'VOLUME', scale: 3 }
    ];

    const insertUnit = db.prepare(`
      INSERT OR IGNORE INTO units (id, name, symbol, dimension, precision_scale)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const u of defaultUnits) {
      insertUnit.run(u.id, u.name, u.symbol, u.dimension, u.scale);
    }

    db.prepare("INSERT OR IGNORE INTO locations (id, name, is_active) VALUES (1, 'Main Retail Store', 1)").run();
    db.prepare("INSERT OR IGNORE INTO locations (id, name, is_active) VALUES (2, 'Central Warehouse', 1)").run();

    db.prepare("INSERT OR IGNORE INTO registers (id, location_id, name, is_active) VALUES (1, 1, 'Counter 01 - Cash Register', 1)").run();
    db.prepare("INSERT OR IGNORE INTO registers (id, location_id, name, is_active) VALUES (2, 1, 'Counter 02 - Express Register', 1)").run();

    const defaultPaymentMethods = [
      { id: 1, name: 'Cash', method_type: 'CASH', affects_drawer: 1 },
      { id: 2, name: 'Bank Transfer', method_type: 'BANK', affects_drawer: 0 },
      { id: 3, name: 'Debit/Credit Card', method_type: 'BANK', affects_drawer: 0 },
      { id: 4, name: 'Easypaisa', method_type: 'DIGITAL_WALLET', affects_drawer: 0 },
      { id: 5, name: 'JazzCash', method_type: 'DIGITAL_WALLET', affects_drawer: 0 }
    ];

    const insertPayMethod = db.prepare(`
      INSERT OR IGNORE INTO payment_methods (id, name, method_type, affects_cash_drawer, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);
    for (const pm of defaultPaymentMethods) {
      insertPayMethod.run(pm.id, pm.name, pm.method_type, pm.affects_drawer);
    }

    db.prepare(`
      INSERT OR IGNORE INTO business_settings (id, business_name, address, phone, currency_code, currency_precision, timezone)
      VALUES (1, 'Modern Retail Supermarket', '123 Commercial Market, Main Boulevard', '+92 300 1234567', 'PKR', 2, 'Asia/Karachi')
    `).run();

    const rolesList = [
      { id: 1, name: 'ADMIN', description: 'Complete system access and configuration' },
      { id: 2, name: 'MANAGER', description: 'Store operations, inventory, and reports' },
      { id: 3, name: 'CASHIER', description: 'POS transactions and cash desk' },
      { id: 4, name: 'INVENTORY_CLERK', description: 'Stock intake and inventory counts' }
    ];

    const insertRole = db.prepare(`
      INSERT OR IGNORE INTO roles (id, name, description)
      VALUES (?, ?, ?)
    `);
    for (const r of rolesList) {
      insertRole.run(r.id, r.name, r.description);
    }

    const permissionsList = [
      { key: 'POS_ACCESS', description: 'Access POS cash counter' },
      { key: 'CREATE_SALE', description: 'Process and complete retail sales' },
      { key: 'VOID_SALE', description: 'Cancel and void completed sales' },
      { key: 'APPLY_DISCOUNT', description: 'Apply order or item discounts' },
      { key: 'VIEW_INVENTORY', description: 'View stock levels and products' },
      { key: 'MANAGE_PRODUCTS', description: 'Create and update products' },
      { key: 'ADJUST_STOCK', description: 'Perform manual stock adjustments' },
      { key: 'PURCHASE_RECEIVE', description: 'Receive vendor inventory bills' },
      { key: 'MANAGE_CUSTOMERS', description: 'Manage customer credit directory' },
      { key: 'MANAGE_SUPPLIERS', description: 'Manage supplier accounts' },
      { key: 'VIEW_ACCOUNTS', description: 'View double-entry general ledger' },
      { key: 'MANAGE_EXPENSES', description: 'Record store overheads' },
      { key: 'VIEW_REPORTS', description: 'View profit/loss and Z-Reports' },
      { key: 'SYSTEM_SETTINGS', description: 'Configure business rules and backup' }
    ];

    const insertPerm = db.prepare(`
      INSERT OR IGNORE INTO permissions (permission_key, description)
      VALUES (?, ?)
    `);
    for (const p of permissionsList) {
      insertPerm.run(p.key, p.description);
    }

    // Link Admin (role 1) with all permissions
    db.exec(`
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT 1, id FROM permissions;
    `);

    // Link Cashier (role 3) with basic POS permissions
    db.exec(`
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT 3, id FROM permissions WHERE permission_key IN ('POS_ACCESS', 'CREATE_SALE', 'APPLY_DISCOUNT', 'VIEW_INVENTORY');
    `);

    db.prepare(`
      INSERT OR IGNORE INTO user_roles (user_id, role_id)
      VALUES (1, 1)
    `).run();

    db.prepare("INSERT OR IGNORE INTO brands (id, name, is_active) VALUES (1, 'Unilever', 1)").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, name, is_active) VALUES (2, 'Nestle', 1)").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, name, is_active) VALUES (3, 'PepsiCo', 1)").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, name, is_active) VALUES (4, 'Generic Brand', 1)").run();

    db.prepare(`
      INSERT OR IGNORE INTO companies (id, name, company_type, phone, address, is_active)
      VALUES (1, 'Samsung Electronics Pakistan', 'WARRANTY_PROVIDER', '+92 42 111726786', 'Gulberg III, Lahore', 1)
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO companies (id, name, company_type, phone, address, is_active)
      VALUES (2, 'Metro Cash & Carry Distributors', 'DISTRIBUTOR', '+92 42 11163876', 'Thokar Niaz Baig, Lahore', 1)
    `).run();

    db.prepare("UPDATE customers SET customer_code = 'CUST-0001' WHERE id = 1 AND (customer_code IS NULL OR customer_code = '')").run();

    // Populate initial stock_balances projection from existing products
    db.exec(`
      INSERT OR IGNORE INTO stock_balances (product_id, variant_id, location_id, batch_id, quantity_base_scaled)
      SELECT id, 0, 1, 0, current_stock FROM products;
    `);

    // Record migration 2
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(2, '002_complete_enterprise_schema');
  });

  transaction();
}
