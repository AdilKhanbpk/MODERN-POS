"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV12 = applyMigrationV12;
function applyMigrationV12(db) {
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. UPGRADE SUPPLIERS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_suppliers (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        supplier_code VARCHAR(50) NOT NULL DEFAULT ('SUP-' || LOWER(HEX(RANDOMBLOB(3)))),
        name VARCHAR(200) NOT NULL,
        contact_person VARCHAR(150),
        phone VARCHAR(30),
        email VARCHAR(255),
        address TEXT,
        tax_number VARCHAR(100),
        payment_terms_days INTEGER NOT NULL DEFAULT 0,
        credit_limit_minor BIGINT DEFAULT 0,
        opening_balance_minor BIGINT NOT NULL DEFAULT 0,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        -- Compatibility columns for legacy components
        balance INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_biz_code
      ON new_suppliers(business_id, supplier_code);

      CREATE INDEX IF NOT EXISTS idx_suppliers_biz_name
      ON new_suppliers(business_id, name);

      CREATE INDEX IF NOT EXISTS idx_suppliers_biz_phone
      ON new_suppliers(business_id, phone);
    `);
        const hasOldSuppliers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='suppliers'").get();
        if (hasOldSuppliers) {
            const cols = db.prepare("PRAGMA table_info(suppliers)").all();
            const hasPaymentTerms = cols.some(c => c.name === 'payment_terms_days');
            if (!hasPaymentTerms) {
                db.prepare(`
          INSERT OR IGNORE INTO new_suppliers (
            id, business_id, supplier_code, name, contact_person, phone, email, address,
            tax_number, payment_terms_days, credit_limit_minor, opening_balance_minor,
            notes, is_active, created_at, balance
          )
          SELECT
            CAST(id AS TEXT),
            '00000000-0000-0000-0000-000000000001',
            COALESCE(supplier_code, 'SUP-' || PRINTF('%04d', id)),
            name,
            contact_person,
            phone,
            email,
            address,
            NULL,
            0,
            0,
            0,
            NULL,
            is_active,
            created_at,
            COALESCE(balance, 0)
          FROM suppliers
        `).run();
                db.exec('DROP TABLE suppliers;');
                db.exec('ALTER TABLE new_suppliers RENAME TO suppliers;');
            }
            else {
                db.exec('DROP TABLE new_suppliers;');
            }
        }
        else {
            db.exec('ALTER TABLE new_suppliers RENAME TO suppliers;');
        }
        // -----------------------------------------------------------------------
        // 2. UPGRADE SUPPLIER_LEDGER_ENTRIES TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_supplier_ledger_entries (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
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
        reversal_of_entry_id UUID REFERENCES new_supplier_ledger_entries(id) ON DELETE SET NULL,
        -- Compatibility columns for legacy components
        source_type TEXT,
        source_id UUID,
        notes TEXT,
        CHECK(NOT (debit_minor > 0 AND credit_minor > 0))
      );

      CREATE INDEX IF NOT EXISTS idx_sle_biz_sup_date
      ON new_supplier_ledger_entries(business_id, supplier_id, entry_date);

      CREATE INDEX IF NOT EXISTS idx_sle_ref
      ON new_supplier_ledger_entries(reference_type, reference_id);
    `);
        const hasOldSle = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_ledger_entries'").get();
        if (hasOldSle) {
            const cols = db.prepare("PRAGMA table_info(supplier_ledger_entries)").all();
            const hasCurrencyCode = cols.some(c => c.name === 'currency_code');
            if (!hasCurrencyCode) {
                db.prepare(`
          INSERT OR IGNORE INTO new_supplier_ledger_entries (
            id, business_id, supplier_id, entry_type, reference_type, reference_id,
            debit_minor, credit_minor, currency_code, description, entry_date, created_at,
            source_type, source_id, notes
          )
          SELECT
            CAST(id AS TEXT),
            '00000000-0000-0000-0000-000000000001',
            supplier_id,
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
          FROM supplier_ledger_entries
        `).run();
                db.exec('DROP TABLE supplier_ledger_entries;');
                db.exec('ALTER TABLE new_supplier_ledger_entries RENAME TO supplier_ledger_entries;');
            }
            else {
                db.exec('DROP TABLE new_supplier_ledger_entries;');
            }
        }
        else {
            db.exec('ALTER TABLE new_supplier_ledger_entries RENAME TO supplier_ledger_entries;');
        }
        // Bidirectional sync triggers for compatibility columns
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_sle_sync_notes_insert
      AFTER INSERT ON supplier_ledger_entries
      WHEN NEW.notes IS NULL AND NEW.description IS NOT NULL
      BEGIN
        UPDATE supplier_ledger_entries SET notes = NEW.description WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_sle_sync_desc_insert
      AFTER INSERT ON supplier_ledger_entries
      WHEN NEW.description IS NULL AND NEW.notes IS NOT NULL
      BEGIN
        UPDATE supplier_ledger_entries SET description = NEW.notes WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_sle_sync_src_insert
      AFTER INSERT ON supplier_ledger_entries
      WHEN NEW.source_type IS NULL AND NEW.reference_type IS NOT NULL
      BEGIN
        UPDATE supplier_ledger_entries
        SET source_type = NEW.reference_type, source_id = NEW.reference_id
        WHERE id = NEW.id;
      END;
    `);
        // -----------------------------------------------------------------------
        // 3. SUPPLIER_PAYMENTS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        payment_number VARCHAR(50) NOT NULL,
        payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
        currency_code CHAR(3) NOT NULL DEFAULT 'PKR',
        payment_method VARCHAR(30) NOT NULL,
        cash_account_id UUID,
        reference_number VARCHAR(100),
        notes TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED', 'REVERSED', 'VOIDED')),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reversal_reason TEXT,
        reversed_at TIMESTAMP,
        reversed_by UUID REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_supp_pay_biz_num ON supplier_payments(business_id, payment_number);
      CREATE INDEX IF NOT EXISTS idx_supp_pay_supplier ON supplier_payments(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_supp_pay_status ON supplier_payments(status);
    `);
        // -----------------------------------------------------------------------
        // 4. SUPPLIER_PAYMENT_ALLOCATIONS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        supplier_payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        purchase_document_id UUID NOT NULL,
        allocated_minor BIGINT NOT NULL CHECK(allocated_minor > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_supp_pay_alloc_payment ON supplier_payment_allocations(supplier_payment_id);
      CREATE INDEX IF NOT EXISTS idx_supp_pay_alloc_purchase ON supplier_payment_allocations(purchase_document_id);
      CREATE INDEX IF NOT EXISTS idx_supp_pay_alloc_biz ON supplier_payment_allocations(business_id);
    `);
        // -----------------------------------------------------------------------
        // 5. RECORD MIGRATION
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(12, '012_supplier_management_and_payable_ledger');
    });
    tx();
}
