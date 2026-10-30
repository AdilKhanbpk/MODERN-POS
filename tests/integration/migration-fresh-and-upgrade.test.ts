import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, applyMigrationV1 } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { BusinessConfigManager } from '../../src/domain/configuration/business-config';

describe('Integration: Database Migrations (Fresh & Upgrade) & Universal Business Configuration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // CRITERION 4: FRESH DATABASE CREATION
  // =========================================================================
  it('creates a fresh database from scratch applying all migrations sequentially (V1 -> V2 -> V3)', () => {
    // 1. Run migrations on virgin database
    runMigrations(db);

    // 2. Verify schema_migrations table records all versions
    const migrations = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as Array<{
      version: number;
      name: string;
    }>;

    expect(migrations.map(m => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);

    // 3. Verify key core tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('users');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('product_variants');
    expect(tableNames).toContain('product_unit_conversions');
    expect(tableNames).toContain('units');
    expect(tableNames).toContain('stock_movements');
    expect(tableNames).toContain('stock_balances');
    expect(tableNames).toContain('stock_adjustments');
    expect(tableNames).toContain('stock_adjustment_lines');
    expect(tableNames).toContain('stock_adjustment_approval_policies');
    expect(tableNames).toContain('stocktakes');
    expect(tableNames).toContain('stocktake_lines');
    expect(tableNames).toContain('stocktake_count_entries');
    expect(tableNames).toContain('stocktake_policies');
    expect(tableNames).toContain('stock_transfers');
    expect(tableNames).toContain('stock_transfer_lines');
    expect(tableNames).toContain('stock_transfer_receipts');
    expect(tableNames).toContain('stock_transfer_receipt_lines');
    expect(tableNames).toContain('inventory_cost_layers');
    expect(tableNames).toContain('inventory_cost_allocations');
    expect(tableNames).toContain('inventory_cost_balances');
    expect(tableNames).toContain('stock_reservations');
    expect(tableNames).toContain('stock_reservation_lines');
    expect(tableNames).toContain('product_reorder_rules');
    expect(tableNames).toContain('replenishment_suggestions');
    expect(tableNames).toContain('product_batch_settings');
    expect(tableNames).toContain('product_batches');
    expect(tableNames).toContain('batch_stock_balances');
    expect(tableNames).toContain('sale_item_batches');
    expect(tableNames).toContain('product_serial_settings');
    expect(tableNames).toContain('product_serial_numbers');
    expect(tableNames).toContain('serial_number_history');
    expect(tableNames).toContain('serial_warranties');
    expect(tableNames).toContain('sale_item_serials');
    expect(tableNames).toContain('sales');
    expect(tableNames).toContain('sale_lines');
    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('customer_ledger_entries');
    expect(tableNames).toContain('customer_payment_allocations');
    expect(tableNames).toContain('suppliers');
    expect(tableNames).toContain('supplier_ledger_entries');
    expect(tableNames).toContain('accounts');
    expect(tableNames).toContain('cash_sessions');
    expect(tableNames).toContain('idempotency_keys');

    // 4. Verify seeded default retail units
    const units = db.prepare('SELECT name, symbol, dimension, precision_scale FROM units').all() as any[];
    expect(units.length).toBeGreaterThanOrEqual(13);
    const piece = units.find(u => u.name === 'Piece');
    expect(piece).toBeDefined();
    expect(piece.precision_scale).toBe(0);

    const kg = units.find(u => u.name === 'Kilogram');
    expect(kg).toBeDefined();
    expect(kg.precision_scale).toBe(3);
  });

  // =========================================================================
  // CRITERION 5: UPGRADE AN EXISTING TEST DATABASE WITHOUT DATA LOSS
  // =========================================================================
  it('upgrades an existing V1 database to V2 and V3 without data loss or corruption', () => {
    // Step 1: Initialize actual V1 schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL UNIQUE,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    applyMigrationV1(db);

    // Verify database is currently at V1 only
    const v1Check = db.prepare('SELECT MAX(version) as ver FROM schema_migrations').get() as { ver: number };
    expect(v1Check.ver).toBe(1);

    // Seed test data into V1 tables
    db.prepare(`
      INSERT INTO products (id, category_id, name, sku, barcode, cost_price, selling_price, current_stock)
      VALUES (99, 1, 'Legacy Sugar 1kg', 'SKU-SUGAR', 'BAR-SUGAR', 8000, 10000, 25)
    `).run();

    db.prepare(`
      INSERT INTO customers (id, name, phone, balance)
      VALUES (99, 'Old Customer', '03001112233', 15000)
    `).run();

    db.prepare(`
      INSERT INTO sales (id, invoice_number, cashier_id, subtotal, grand_total, payment_method)
      VALUES (99, 'INV-LEGACY-001', 1, 10000, 10000, 'CASH')
    `).run();

    db.prepare(`
      INSERT INTO sale_items (id, sale_id, product_id, product_name, product_barcode, unit_name, quantity, conversion_factor, unit_price, cost_price, line_discount, line_tax, line_total, line_profit)
      VALUES (99, 99, 99, 'Legacy Sugar 1kg', 'BAR-SUGAR', 'Piece', 1, 1, 10000, 8000, 0, 0, 10000, 2000)
    `).run();

    // Step 2: Execute migration runner to upgrade this V1 database to V2, V3, V4, V5, V6 and V7
    runMigrations(db);

    // Step 3: Verify migration version was upgraded to 22
    const maxVer = db.prepare('SELECT MAX(version) as ver FROM schema_migrations').get() as { ver: number };
    expect(maxVer.ver).toBe(22);

    // Step 4: Verify existing V1 data was preserved with 100% integrity
    const product = db.prepare('SELECT * FROM products WHERE id = 99').get() as any;
    expect(product.name).toBe('Legacy Sugar 1kg');
    expect(product.sku).toBe('SKU-SUGAR');
    expect(product.current_stock).toBe(25);

    const customer = db.prepare('SELECT * FROM customers WHERE id = 99').get() as any;
    expect(customer.name).toBe('Old Customer');
    expect(customer.balance).toBe(15000);

    const sale = db.prepare('SELECT * FROM sales WHERE id = 99').get() as any;
    expect(sale.invoice_number).toBe('INV-LEGACY-001');

    // Step 5: Verify newly added enterprise columns exist and work properly
    expect(product.default_cost_minor).toBeDefined();
    expect(product.reorder_level_scaled).toBeDefined();

    // Verify sale_lines table was created with Part 3 snapshot columns
    const saleLineCols = db.prepare('PRAGMA table_info(sale_lines)').all() as Array<{ name: string }>;
    const colNames = saleLineCols.map(c => c.name);
    expect(colNames).toContain('allocated_bill_discount_minor');
    expect(colNames).toContain('tax_rate');
    expect(colNames).toContain('is_tax_inclusive');
    expect(colNames).toContain('line_profit_minor');
  });

  // =========================================================================
  // CRITERION 7: UNIVERSAL BUSINESS CONFIGURATION & INDEPENDENT MODULES
  // =========================================================================
  describe('Universal Business Configuration Modular Independence', () => {
    it('supports different business profiles with correct feature flags', () => {
      const grocery = BusinessConfigManager.getPreset('GROCERY');
      expect(grocery.enableWeighingScale).toBe(true);
      expect(grocery.enableBatchTracking).toBe(true);
      expect(grocery.enableVariants).toBe(false);

      const pharmacy = BusinessConfigManager.getPreset('PHARMACY');
      expect(pharmacy.enableBatchTracking).toBe(true);
      expect(pharmacy.enableExpiryTracking).toBe(true);
      expect(pharmacy.enableFefoSelection).toBe(true);
      expect(pharmacy.enablePrescriptionManagement).toBe(true);

      const apparel = BusinessConfigManager.getPreset('APPAREL');
      expect(apparel.enableVariants).toBe(true);
      expect(apparel.enableWeighingScale).toBe(false);

      const electronics = BusinessConfigManager.getPreset('ELECTRONICS');
      expect(electronics.enableSerialTracking).toBe(true);
      expect(electronics.enableWarrantyManagement).toBe(true);
      expect(electronics.enableServiceHistory).toBe(true);

      const lab = BusinessConfigManager.getPreset('LABORATORY');
      expect(lab.enableSerialTracking).toBe(true);
      expect(lab.enableServiceHistory).toBe(true);
    });

    it('enforces module guards when a feature is disabled without corrupting existing records', () => {
      const config = BusinessConfigManager.getPreset('GROCERY'); // Serial tracking is disabled

      expect(() => {
        BusinessConfigManager.assertModuleEnabled(config, 'enableSerialTracking', 'Assign Serial Number');
      }).toThrow(/requires module "enableSerialTracking"/);

      // Re-enabling the feature dynamically restores access
      const updatedConfig = BusinessConfigManager.resolveConfig('GROCERY', { enableSerialTracking: true });
      expect(() => {
        BusinessConfigManager.assertModuleEnabled(updatedConfig, 'enableSerialTracking', 'Assign Serial Number');
      }).not.toThrow();
    });
  });
});

