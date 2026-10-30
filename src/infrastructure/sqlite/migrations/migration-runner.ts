import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { Role } from '../../../shared/constants/roles-permissions';
import { AccountType, StandardAccountCode } from '../../../shared/constants/accounts';

import { applyMigrationV2 } from './002_enterprise_schema';
import { applyMigrationV3 } from './003_part3_scale_snapshots';
import { applyMigrationV4 } from './004_universal_enterprise_structure';
import { applyMigrationV5 } from './005_onboarding_module_catalog';
import { applyMigrationV6 } from './006_auth_sessions_and_approvals';
import { applyMigrationV7 } from './007_module_installations_and_events';
import { applyMigrationV8 } from './008_product_catalogue_enterprise';
import { applyMigrationV9 } from './009_units_and_conversions_enterprise';
import { applyMigrationV10 } from './010_barcodes_and_scale_profiles';
import { applyMigrationV11 } from './011_customer_management_and_credit_ledger';
import { applyMigrationV12 } from './012_supplier_management_and_payable_ledger';
import { applyMigrationV13 } from './013_stock_locations_and_balances';
import { applyMigrationV14 } from './014_stock_movement_ledger';
import { applyMigrationV15 } from './015_stock_adjustments';
import { applyMigrationV16 } from './016_stocktakes_and_physical_counting';
import { applyMigrationV17 } from './017_stock_transfers_and_in_transit';
import { applyMigrationV18 } from './018_inventory_valuation_and_costing';
import { applyMigrationV19 } from './019_stock_reservations';
import { applyMigrationV20 } from './020_stock_replenishment_and_monitoring';
import { applyMigrationV21 } from './021_batch_and_expiry_management';
import { applyMigrationV22 } from './022_serial_number_tracking';
import { applyMigrationV23 } from './023_purchase_orders_workflow';

export function runMigrations(db: Database.Database): void {
  // 1. Create schema_migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
  const currentVersion = currentVersionRow?.version || 0;

  if (currentVersion < 1) {
    applyMigrationV1(db);
  }

  if (currentVersion < 2) {
    applyMigrationV2(db);
  }

  if (currentVersion < 3) {
    applyMigrationV3(db);
  }

  if (currentVersion < 4) {
    applyMigrationV4(db);
  }

  if (currentVersion < 5) {
    applyMigrationV5(db);
  }

  if (currentVersion < 6) {
    applyMigrationV6(db);
  }

  if (currentVersion < 7) {
    applyMigrationV7(db);
  }

  if (currentVersion < 8) {
    applyMigrationV8(db);
  }

  if (currentVersion < 9) {
    applyMigrationV9(db);
  }

  if (currentVersion < 10) {
    applyMigrationV10(db);
  }

  if (currentVersion < 11) {
    applyMigrationV11(db);
  }

  if (currentVersion < 12) {
    applyMigrationV12(db);
  }

  if (currentVersion < 13) {
    applyMigrationV13(db);
  }

  if (currentVersion < 14) {
    applyMigrationV14(db);
  }

  if (currentVersion < 15) {
    applyMigrationV15(db);
  }

  if (currentVersion < 16) {
    applyMigrationV16(db);
  }

  if (currentVersion < 17) {
    applyMigrationV17(db);
  }

  if (currentVersion < 18) {
    applyMigrationV18(db);
  }

  if (currentVersion < 19) {
    applyMigrationV19(db);
  }

  if (currentVersion < 20) {
    applyMigrationV20(db);
  }

  if (currentVersion < 21) {
    applyMigrationV21(db);
  }

  if (currentVersion < 22) {
    applyMigrationV22(db);
  }

  if (currentVersion < 23) {
    applyMigrationV23(db);
  }
}

export function applyMigrationV1(db: Database.Database): void {
  const transaction = db.transaction(() => {
    // Users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_CLERK')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Product Categories
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Products
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        barcode TEXT NOT NULL UNIQUE,
        base_unit TEXT NOT NULL DEFAULT 'Piece',
        cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
        selling_price INTEGER NOT NULL DEFAULT 0 CHECK(selling_price >= 0),
        current_stock REAL NOT NULL DEFAULT 0,
        min_stock_level REAL NOT NULL DEFAULT 5,
        tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
        is_tax_inclusive INTEGER NOT NULL DEFAULT 0 CHECK(is_tax_inclusive IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    `);

    // Product Multi-Units
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit_name TEXT NOT NULL,
        conversion_factor REAL NOT NULL CHECK(conversion_factor > 0),
        barcode TEXT,
        selling_price INTEGER NOT NULL CHECK(selling_price >= 0),
        UNIQUE(product_id, unit_name)
      );
    `);

    // Stock Movements log (immutable audit trail)
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        previous_stock REAL NOT NULL,
        new_stock REAL NOT NULL,
        reference_type TEXT,
        reference_id INTEGER,
        reason TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    `);

    // Customers
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        email TEXT,
        address TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit >= 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    `);

    // Customer Ledger Entries
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        transaction_type TEXT NOT NULL,
        reference_id INTEGER,
        debit INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 0,
        running_balance INTEGER NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cust_ledger ON customer_ledger(customer_id);
    `);

    // Suppliers
    db.exec(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        contact_person TEXT,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Supplier Ledger Entries
    db.exec(`
      CREATE TABLE IF NOT EXISTS supplier_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        transaction_type TEXT NOT NULL,
        reference_id INTEGER,
        debit INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 0,
        running_balance INTEGER NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Sales Orders
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
        cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
        total_discount INTEGER NOT NULL DEFAULT 0 CHECK(total_discount >= 0),
        total_tax INTEGER NOT NULL DEFAULT 0 CHECK(total_tax >= 0),
        grand_total INTEGER NOT NULL CHECK(grand_total >= 0),
        total_cost INTEGER NOT NULL DEFAULT 0,
        profit INTEGER NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL,
        amount_paid INTEGER NOT NULL DEFAULT 0,
        change_given INTEGER NOT NULL DEFAULT 0,
        customer_balance_change INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_number);
    `);

    // Sale Items
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        product_barcode TEXT NOT NULL,
        unit_name TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        conversion_factor REAL NOT NULL CHECK(conversion_factor > 0),
        unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
        cost_price INTEGER NOT NULL DEFAULT 0,
        line_discount INTEGER NOT NULL DEFAULT 0,
        line_tax INTEGER NOT NULL DEFAULT 0,
        line_total INTEGER NOT NULL CHECK(line_total >= 0),
        line_profit INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    `);

    // Purchase Orders
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        invoice_number TEXT NOT NULL,
        subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
        additional_cost INTEGER NOT NULL DEFAULT 0 CHECK(additional_cost >= 0),
        grand_total INTEGER NOT NULL CHECK(grand_total >= 0),
        amount_paid INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Purchase Order Items
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        unit_name TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        conversion_factor REAL NOT NULL CHECK(conversion_factor > 0),
        unit_cost_price INTEGER NOT NULL CHECK(unit_cost_price >= 0),
        selling_price INTEGER NOT NULL CHECK(selling_price >= 0),
        line_total INTEGER NOT NULL CHECK(line_total >= 0)
      );
    `);

    // Chart of Accounts
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
        balance INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Journal Entries (Double-Entry Header)
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_number TEXT NOT NULL UNIQUE,
        reference_type TEXT NOT NULL,
        reference_id INTEGER,
        description TEXT NOT NULL,
        total_amount INTEGER NOT NULL CHECK(total_amount >= 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Journal Entry Lines (Double-Entry Details)
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        debit INTEGER NOT NULL DEFAULT 0 CHECK(debit >= 0),
        credit INTEGER NOT NULL DEFAULT 0 CHECK(credit >= 0),
        memo TEXT
      );
    `);

    // Expense Categories
    db.exec(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
    `);

    // Expenses
    db.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
        paid_from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL CHECK(amount > 0),
        recipient TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Employees
    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        designation TEXT NOT NULL,
        base_salary INTEGER NOT NULL CHECK(base_salary >= 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Payroll Runs
    db.exec(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        month TEXT NOT NULL,
        base_salary INTEGER NOT NULL,
        allowance INTEGER NOT NULL DEFAULT 0,
        deduction INTEGER NOT NULL DEFAULT 0,
        net_payable INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PAID',
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, month)
      );
    `);

    // System Settings key-value
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Audit Log
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default admin user (password: admin123)
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    db.prepare(`
      INSERT OR IGNORE INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run('admin', hash, 'Administrator', Role.ADMIN);

    // Seed standard Chart of Accounts
    const standardAccounts = [
      { code: StandardAccountCode.CASH_ON_HAND, name: 'Cash On Hand', type: AccountType.ASSET },
      { code: StandardAccountCode.BANK_ACCOUNT, name: 'Bank Account', type: AccountType.ASSET },
      { code: StandardAccountCode.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable (Customers)', type: AccountType.ASSET },
      { code: StandardAccountCode.INVENTORY_ASSET, name: 'Inventory Asset', type: AccountType.ASSET },
      { code: StandardAccountCode.EQUIPMENT, name: 'Store Equipment & Fixtures', type: AccountType.ASSET },
      { code: StandardAccountCode.ACCOUNTS_PAYABLE, name: 'Accounts Payable (Suppliers)', type: AccountType.LIABILITY },
      { code: StandardAccountCode.SALES_TAX_PAYABLE, name: 'Sales Tax Payable', type: AccountType.LIABILITY },
      { code: StandardAccountCode.SALARY_PAYABLE, name: 'Salaries Payable', type: AccountType.LIABILITY },
      { code: StandardAccountCode.OWNERS_EQUITY, name: 'Owner Capital Equity', type: AccountType.EQUITY },
      { code: StandardAccountCode.RETAINED_EARNINGS, name: 'Retained Earnings', type: AccountType.EQUITY },
      { code: StandardAccountCode.SALES_REVENUE, name: 'Sales Revenue', type: AccountType.REVENUE },
      { code: StandardAccountCode.DISCOUNTS_ALLOWED, name: 'Sales Discounts Allowed', type: AccountType.REVENUE },
      { code: StandardAccountCode.RETURNS_REFUNDS, name: 'Sales Returns & Refunds', type: AccountType.REVENUE },
      { code: StandardAccountCode.COST_OF_GOODS_SOLD, name: 'Cost of Goods Sold (COGS)', type: AccountType.EXPENSE },
      { code: StandardAccountCode.SALARY_EXPENSE, name: 'Salaries Expense', type: AccountType.EXPENSE },
      { code: StandardAccountCode.RENT_EXPENSE, name: 'Store Rent Expense', type: AccountType.EXPENSE },
      { code: StandardAccountCode.UTILITIES_EXPENSE, name: 'Utilities Expense', type: AccountType.EXPENSE },
      { code: StandardAccountCode.GENERAL_EXPENSE, name: 'General & Admin Expense', type: AccountType.EXPENSE }
    ];

    const insertAccount = db.prepare(`
      INSERT OR IGNORE INTO accounts (code, name, type, balance, is_active)
      VALUES (?, ?, ?, 0, 1)
    `);
    for (const acc of standardAccounts) {
      insertAccount.run(acc.code, acc.name, acc.type);
    }

    // Seed default categories
    db.prepare("INSERT OR IGNORE INTO product_categories (id, name, description) VALUES (1, 'General Goods', 'Standard retail merchandise')").run();
    db.prepare("INSERT OR IGNORE INTO product_categories (id, name, description) VALUES (2, 'Beverages', 'Cold drinks, juices & water')").run();
    db.prepare("INSERT OR IGNORE INTO product_categories (id, name, description) VALUES (3, 'Snacks & Bakery', 'Packaged snacks and baked goods')").run();

    // Seed expense categories
    db.prepare("INSERT OR IGNORE INTO expense_categories (id, name) VALUES (1, 'Store Rent')").run();
    db.prepare("INSERT OR IGNORE INTO expense_categories (id, name) VALUES (2, 'Electricity & Utilities')").run();
    db.prepare("INSERT OR IGNORE INTO expense_categories (id, name) VALUES (3, 'Employee Salaries')").run();
    db.prepare("INSERT OR IGNORE INTO expense_categories (id, name) VALUES (4, 'Store Maintenance & Cleaning')").run();
    db.prepare("INSERT OR IGNORE INTO expense_categories (id, name) VALUES (5, 'Printing & Stationeries')").run();

    // Seed default customer (Walk-in Customer)
    db.prepare(`
      INSERT OR IGNORE INTO customers (id, name, phone, balance, credit_limit, is_active)
      VALUES (1, 'Walk-in Customer', '0000000000', 0, 0, 1)
    `).run();

    // Seed initial system settings
    const defaultSettings: Record<string, string> = {
      storeName: 'Modern Retail Supermarket',
      storeAddress: '123 Commercial Market, Main Blvd',
      storePhone: '+92 300 1234567',
      currencySymbol: 'Rs. ',
      currencyCode: 'PKR',
      defaultTaxRate: '0',
      isTaxInclusive: 'true',
      receiptHeader: 'Thank you for shopping with us!',
      receiptFooter: 'Goods once sold are exchangeable within 3 days with receipt.',
      autoPrintReceipt: 'true',
      backupPath: './backups',
      autoBackupOnClose: 'true'
    };

    const insertSetting = db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaultSettings)) {
      insertSetting.run(k, v);
    }

    // Record migration 1
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(1, '001_initial_schema');
  });

  transaction();
}
