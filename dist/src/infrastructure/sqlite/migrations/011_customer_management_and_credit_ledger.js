"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV11 = applyMigrationV11;
function applyMigrationV11(db) {
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. UPGRADE CUSTOMERS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_customers (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        customer_code VARCHAR(50) NOT NULL,
        name VARCHAR(200) NOT NULL,
        phone VARCHAR(30),
        email VARCHAR(255),
        address TEXT,
        tax_number VARCHAR(100),
        customer_type VARCHAR(30) NOT NULL DEFAULT 'retail' CHECK(customer_type IN ('retail', 'wholesale', 'business', 'other')),
        credit_limit_minor BIGINT DEFAULT 0,
        credit_days INTEGER NOT NULL DEFAULT 0,
        opening_balance_minor BIGINT NOT NULL DEFAULT 0,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        -- Compatibility columns for legacy components
        balance INTEGER NOT NULL DEFAULT 0,
        credit_limit INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_biz_code
      ON new_customers(business_id, customer_code);

      CREATE INDEX IF NOT EXISTS idx_customers_biz_name
      ON new_customers(business_id, name);

      CREATE INDEX IF NOT EXISTS idx_customers_biz_phone
      ON new_customers(business_id, phone);
    `);
        const hasOldCustomers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();
        if (hasOldCustomers) {
            const cols = db.prepare("PRAGMA table_info(customers)").all();
            const hasCustomerType = cols.some(c => c.name === 'customer_type');
            if (!hasCustomerType) {
                db.prepare(`
          INSERT OR IGNORE INTO new_customers (
            id, business_id, customer_code, name, phone, email, address,
            customer_type, credit_limit_minor, credit_days, opening_balance_minor,
            notes, is_active, created_at, balance, credit_limit
          )
          SELECT
            CAST(id AS TEXT),
            '00000000-0000-0000-0000-000000000001',
            COALESCE(customer_code, 'CUST-' || PRINTF('%04d', id)),
            name,
            phone,
            email,
            address,
            'retail',
            COALESCE(credit_limit_minor, credit_limit, 0),
            0,
            0,
            NULL,
            is_active,
            created_at,
            COALESCE(balance, 0),
            COALESCE(credit_limit, 0)
          FROM customers
        `).run();
                db.exec('DROP TABLE customers;');
                db.exec('ALTER TABLE new_customers RENAME TO customers;');
            }
            else {
                db.exec('DROP TABLE new_customers;');
            }
        }
        else {
            db.exec('ALTER TABLE new_customers RENAME TO customers;');
        }
        // -----------------------------------------------------------------------
        // 2. SEED DEFAULT WALK-IN CUSTOMER RECORD
        // -----------------------------------------------------------------------
        // Ensures every business has a dedicated Walk-in Customer record
        const businesses = db.prepare('SELECT id FROM businesses').all();
        const seedWalkInStmt = db.prepare(`
      INSERT OR IGNORE INTO customers (
        id, business_id, customer_code, name, customer_type,
        credit_limit_minor, credit_days, opening_balance_minor,
        is_active, notes, balance, credit_limit
      )
      VALUES (?, ?, 'WALK-IN', 'Walk-in Customer', 'retail', 0, 0, 0, 1, 'Standard counter cash customer', 0, 0)
    `);
        for (const biz of businesses) {
            seedWalkInStmt.run(`00000000-0000-0000-0000-${biz.id.slice(-12)}`, biz.id);
        }
        // Also ensure default fallback business walk-in exists
        seedWalkInStmt.run('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001');
        // -----------------------------------------------------------------------
        // 3. UPGRADE CUSTOMER_LEDGER_ENTRIES TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_customer_ledger_entries (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        entry_type VARCHAR(40) NOT NULL,
        reference_type VARCHAR(40),
        reference_id UUID,
        debit_minor BIGINT NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
        credit_minor BIGINT NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
        currency_code CHAR(3) NOT NULL DEFAULT 'PKR',
        description TEXT,
        entry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reversal_of_entry_id UUID REFERENCES new_customer_ledger_entries(id) ON DELETE SET NULL,
        -- Compatibility columns for legacy components
        source_type TEXT,
        source_id UUID,
        notes TEXT,
        CHECK(NOT (debit_minor > 0 AND credit_minor > 0))
      );

      CREATE INDEX IF NOT EXISTS idx_cle_biz_cust_date
      ON new_customer_ledger_entries(business_id, customer_id, entry_date);

      CREATE INDEX IF NOT EXISTS idx_cle_ref
      ON new_customer_ledger_entries(reference_type, reference_id);
    `);
        const hasOldCle = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_ledger_entries'").get();
        if (hasOldCle) {
            const cols = db.prepare("PRAGMA table_info(customer_ledger_entries)").all();
            const hasCurrencyCode = cols.some(c => c.name === 'currency_code');
            if (!hasCurrencyCode) {
                db.prepare(`
          INSERT OR IGNORE INTO new_customer_ledger_entries (
            id, business_id, customer_id, entry_type, reference_type, reference_id,
            debit_minor, credit_minor, currency_code, description, entry_date, created_at,
            source_type, source_id, notes
          )
          SELECT
            CAST(id AS TEXT),
            '00000000-0000-0000-0000-000000000001',
            customer_id,
            entry_type,
            source_type,
            source_id,
            debit_minor,
            credit_minor,
            'PKR',
            notes,
            created_at,
            created_at,
            source_type,
            source_id,
            notes
          FROM customer_ledger_entries
        `).run();
                db.exec('DROP TABLE customer_ledger_entries;');
                db.exec('ALTER TABLE new_customer_ledger_entries RENAME TO customer_ledger_entries;');
            }
            else {
                db.exec('DROP TABLE new_customer_ledger_entries;');
            }
        }
        else {
            db.exec('ALTER TABLE new_customer_ledger_entries RENAME TO customer_ledger_entries;');
        }
        // Bidirectional sync triggers for compatibility columns
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cle_sync_notes_insert
      AFTER INSERT ON customer_ledger_entries
      WHEN NEW.notes IS NULL AND NEW.description IS NOT NULL
      BEGIN
        UPDATE customer_ledger_entries SET notes = NEW.description WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_cle_sync_desc_insert
      AFTER INSERT ON customer_ledger_entries
      WHEN NEW.description IS NULL AND NEW.notes IS NOT NULL
      BEGIN
        UPDATE customer_ledger_entries SET description = NEW.notes WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_cle_sync_src_insert
      AFTER INSERT ON customer_ledger_entries
      WHEN NEW.source_type IS NULL AND NEW.reference_type IS NOT NULL
      BEGIN
        UPDATE customer_ledger_entries
        SET source_type = NEW.reference_type, source_id = NEW.reference_id
        WHERE id = NEW.id;
      END;
    `);
        // -----------------------------------------------------------------------
        // 4. CUSTOMER_PAYMENT_ALLOCATIONS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS customer_payment_allocations (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        payment_id UUID NOT NULL,
        sales_document_id UUID NOT NULL,
        allocated_minor BIGINT NOT NULL CHECK(allocated_minor > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_cust_pay_alloc_payment ON customer_payment_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS idx_cust_pay_alloc_sale ON customer_payment_allocations(sales_document_id);
      CREATE INDEX IF NOT EXISTS idx_cust_pay_alloc_biz ON customer_payment_allocations(business_id);
    `);
        // -----------------------------------------------------------------------
        // 5. CREDIT POLICY CONFIGURATION IN BUSINESSES TABLE
        // -----------------------------------------------------------------------
        // Ensure businesses have credit control policy configured
        const hasBusinessesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='businesses'").get();
        if (hasBusinessesTable) {
            const bizCols = db.prepare("PRAGMA table_info(businesses)").all();
            const hasCreditPolicy = bizCols.some(c => c.name === 'credit_policy');
            if (!hasCreditPolicy) {
                db.exec(`
          ALTER TABLE businesses
          ADD COLUMN credit_policy VARCHAR(30) NOT NULL DEFAULT 'BLOCK';
        `);
            }
        }
        // -----------------------------------------------------------------------
        // 6. RECORD MIGRATION
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(11, '011_customer_management_and_credit_ledger');
    });
    tx();
}
