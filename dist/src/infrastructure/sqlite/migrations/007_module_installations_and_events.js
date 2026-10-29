"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV7 = applyMigrationV7;
const crypto_1 = __importDefault(require("crypto"));
function applyMigrationV7(db) {
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. MODULE_INSTALLATIONS TABLE
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS module_installations (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES module_definitions(id) ON DELETE CASCADE,
        installed_version TEXT NOT NULL DEFAULT '1.0.0',
        installed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        last_migration_at TEXT,
        installation_status TEXT NOT NULL DEFAULT 'INSTALLED' CHECK(installation_status IN ('INSTALLED', 'FAILED', 'UPGRADING')),
        error_message TEXT,
        UNIQUE (module_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mod_install_status ON module_installations(installation_status);
    `);
        // -----------------------------------------------------------------------
        // 2. MODULE_EVENTS TABLE (Idempotent Event Log)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS module_events (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        module_code TEXT NOT NULL,
        event_code TEXT NOT NULL,
        payload TEXT NOT NULL, -- JSON
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        processed_at TEXT,
        processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(processing_status IN ('PENDING', 'PROCESSED', 'FAILED'))
      );
      CREATE INDEX IF NOT EXISTS idx_mod_events_biz ON module_events(business_id, module_code);
      CREATE INDEX IF NOT EXISTS idx_mod_events_status ON module_events(processing_status);
    `);
        // -----------------------------------------------------------------------
        // 3. MASTER CATALOG: 15 CORE & 28 OPTIONAL MODULES
        // -----------------------------------------------------------------------
        const fullModuleCatalog = [
            // --- 15 CORE MODULES ---
            {
                code: 'business_setup',
                name: 'Business Setup',
                desc: 'Core store configuration, regional currency, branch hierarchy, and settings',
                enables: 'Store profile, timezone, currency precision, and document numbering',
                is_core: 1,
                deps: null
            },
            {
                code: 'authentication',
                name: 'Authentication',
                desc: 'Security tokens, password hashing, roles, granular RBAC, and session management',
                enables: 'User login, permission verification, account lockout, and supervisor approvals',
                is_core: 1,
                deps: null
            },
            {
                code: 'products',
                name: 'Products',
                desc: 'Catalog master, SKUs, barcodes, pricing, and category classifications',
                enables: 'Product item catalog, barcode scanning, and default retail pricing',
                is_core: 1,
                deps: null
            },
            {
                code: 'customers',
                name: 'Customers',
                desc: 'Customer directory, contact records, and customer identification',
                enables: 'Customer profiles and walk-in/loyalty assignment on sales',
                is_core: 1,
                deps: null
            },
            {
                code: 'suppliers',
                name: 'Suppliers',
                desc: 'Supplier directory, vendor contacts, and purchasing sources',
                enables: 'Vendor master records and procurement management',
                is_core: 1,
                deps: null
            },
            {
                code: 'units',
                name: 'Units',
                desc: 'Measurement units, unit dimensions, precision scales, and conversion ratios',
                enables: 'Base units of measure (Piece, Kg, Litre) and fixed-point quantity scale',
                is_core: 1,
                deps: null
            },
            {
                code: 'sales',
                name: 'Sales',
                desc: 'POS register checkout, line item calculation, order discounts, and receipt generation',
                enables: 'Sales invoicing, receipt printing, and revenue recognition',
                is_core: 1,
                deps: null
            },
            {
                code: 'purchases',
                name: 'Purchases',
                desc: 'Purchase bills, landed cost inventory intake, and vendor stock replenishment',
                enables: 'Supplier billing, cost averaging, and inventory stock-in',
                is_core: 1,
                deps: null
            },
            {
                code: 'inventory_ledger',
                name: 'Inventory Ledger',
                desc: 'Traceable stock movements, running stock balances, and physical count reconciliation',
                enables: 'Real-time stock ledger, minimum reorder alerts, and audit adjustments',
                is_core: 1,
                deps: null
            },
            {
                code: 'payments',
                name: 'Payments',
                desc: 'Payment collection, tender types (Cash, Bank, Wallet), and allocation tracking',
                enables: 'Multi-tender settlement, payment allocation, and receipts',
                is_core: 1,
                deps: null
            },
            {
                code: 'cash_register',
                name: 'Cash Register',
                desc: 'Cash drawer tracking, shift opening floats, and closing cash reconciliation',
                enables: 'Cash drawer accountability and daily X/Z register reports',
                is_core: 1,
                deps: null
            },
            {
                code: 'expenses',
                name: 'Expenses',
                desc: 'Operating expenditure categories, expense vouchers, and drawer cash disbursements',
                enables: 'Store expense logging and operational cash outflows',
                is_core: 1,
                deps: null
            },
            {
                code: 'reports',
                name: 'Reports',
                desc: 'Sales performance, daily Z-report, inventory valuation, and tax summaries',
                enables: 'Operational analytics, daily register reconciliation, and tax reports',
                is_core: 1,
                deps: null
            },
            {
                code: 'audit',
                name: 'Audit',
                desc: 'Immutable append-only audit trail and administrative security logging',
                enables: 'Non-repudiation audit records for sensitive changes and user actions',
                is_core: 1,
                deps: null
            },
            {
                code: 'backup_restore',
                name: 'Backup and Restore',
                desc: 'Local database snapshots, automatic shift closing backups, and recovery',
                enables: 'Automated offline backup archives and database restore engine',
                is_core: 1,
                deps: null
            },
            // --- 28 OPTIONAL MODULES ---
            {
                code: 'batch_expiry',
                name: 'Batch & Expiry Date Tracking',
                desc: 'Perishable lot tracking, manufacturing dates, and expiry date alerts',
                enables: 'Batch lot numbers, expiry tracking, and lot-based inventory valuation',
                is_core: 0,
                deps: ['inventory_ledger']
            },
            {
                code: 'fefo',
                name: 'FEFO',
                desc: 'First-Expiry-First-Out automated batch picking and stock rotation',
                enables: 'Automated priority picking of earliest expiring batches to prevent spoilage',
                is_core: 0,
                deps: ['batch_expiry']
            },
            {
                code: 'serial_tracking',
                name: 'Serial Number Tracking',
                desc: 'Unique unit serialization and IMEI tracking for electronics and appliances',
                enables: 'Serialized unit tracking from purchase intake to sales checkout',
                is_core: 0,
                deps: ['inventory_ledger']
            },
            {
                code: 'warranty_repair',
                name: 'Warranty and Repair',
                desc: 'Customer warranty claims, RMA tracking, and vendor repair job cards',
                enables: 'Warranty claim processing, equipment repair status, and vendor RMA',
                is_core: 0,
                deps: ['serial_tracking']
            },
            {
                code: 'product_variants',
                name: 'Product Variants',
                desc: 'Size, color, and fit matrix for apparel, footwear, and cosmetics',
                enables: 'Multi-dimensional SKU variant matrices with individual barcode & pricing',
                is_core: 0,
                deps: ['products']
            },
            {
                code: 'weighing_scale',
                name: 'Weighing Scale Integration',
                desc: 'Electronic hardware scale serial/USB streaming directly into checkout cart',
                enables: 'Live weight streaming for produce, fruits, vegetables, and meat',
                is_core: 0,
                deps: null
            },
            {
                code: 'scale_barcode_parsing',
                name: 'Scale Barcode Parsing',
                desc: 'Embedded price and weight barcode parsing (EAN-13 in-store barcodes)',
                enables: 'Auto-detecting item code and packed weight from pre-printed scale labels',
                is_core: 0,
                deps: ['products']
            },
            {
                code: 'purchase_orders',
                name: 'Purchase Orders',
                desc: 'Supplier purchase orders, delivery scheduling, and supplier approval',
                enables: 'Formal PO creation, pending delivery tracking, and supplier confirmations',
                is_core: 0,
                deps: ['purchases']
            },
            {
                code: 'goods_receiving',
                name: 'Goods Receiving',
                desc: 'Warehouse goods receipt notes (GRN) and multi-step delivery verification',
                enables: 'Physical delivery inspection against purchase orders prior to billing',
                is_core: 0,
                deps: ['purchases', 'inventory_ledger']
            },
            {
                code: 'stock_transfers',
                name: 'Stock Transfers',
                desc: 'Inter-branch and inter-warehouse stock transfer orders and dispatch tracking',
                enables: 'Stock transfer requests, in-transit stock tracking, and destination receipt',
                is_core: 0,
                deps: ['inventory_ledger']
            },
            {
                code: 'multiple_warehouses',
                name: 'Multiple Warehouses',
                desc: 'Managing distinct storage warehouses, back rooms, and retail shelves',
                enables: 'Separate inventory ledger per warehouse location within a branch',
                is_core: 0,
                deps: ['inventory_ledger']
            },
            {
                code: 'wholesale_pricing',
                name: 'Wholesale Pricing',
                desc: 'Tiered volume pricing, wholesale dealer rates, and customer group discounts',
                enables: 'Quantity-break price tables and dealer-specific price lists',
                is_core: 0,
                deps: ['products']
            },
            {
                code: 'customer_credit',
                name: 'Customer Credit',
                desc: 'Customer credit limits, accounts receivable ledger, and running khata statements',
                enables: 'Credit sales, credit limit checks, and customer running ledger statements',
                is_core: 0,
                deps: ['customers']
            },
            {
                code: 'loyalty',
                name: 'Loyalty',
                desc: 'Customer points accumulation, loyalty tiers, and points redemption',
                enables: 'Point-earning rules, tier upgrades, and checkout discount redemption',
                is_core: 0,
                deps: ['customers']
            },
            {
                code: 'promotions',
                name: 'Promotions',
                desc: 'Buy-One-Get-One (BOGO), combo deals, and scheduled promotional discounts',
                enables: 'Automated promotion engine applying bundle and seasonal cart rules',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'quotations',
                name: 'Quotations',
                desc: 'Price quotation drafting, customer estimates, and one-click quote-to-sale conversion',
                enables: 'Issuing price quotes with validity periods and converting to sales invoices',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'sales_orders',
                name: 'Sales Orders',
                desc: 'Advance customer orders, partial payment booking, and future delivery fulfillment',
                enables: 'Booking customer advance orders and tracking dispatch fulfillment',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'reservations',
                name: 'Reservations',
                desc: 'Reserving stock for layaway or pending customer pickup without billing',
                enables: 'Hard reservation of physical stock preventing accidental sale to others',
                is_core: 0,
                deps: ['inventory_ledger']
            },
            {
                code: 'multi_counter',
                name: 'Multi-Counter',
                desc: 'Multiple simultaneous checkout terminals linked to shared local database',
                enables: 'Register station management and multi-counter cash drawer tracking',
                is_core: 0,
                deps: ['cash_register']
            },
            {
                code: 'multi_branch',
                name: 'Multi-Branch',
                desc: 'Multiple physical store branches with central PostgreSQL synchronization',
                enables: 'Store location management, consolidated sales, and head-office sync',
                is_core: 0,
                deps: ['business_setup']
            },
            {
                code: 'tax_extensions',
                name: 'Tax Extensions',
                desc: 'Multi-tier VAT/GST rates, tax exemptions, and FBR POS fiscal invoicing',
                enables: 'FBR fiscal invoice integration and advanced tax classification rules',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'employee_management',
                name: 'Employee Management',
                desc: 'Staff directory, job positions, employment terms, and compensation baselines',
                enables: 'Employee profiles, role assignments, and base salary records',
                is_core: 0,
                deps: null
            },
            {
                code: 'attendance',
                name: 'Attendance',
                desc: 'Employee daily biometric/manual clock-in and work shift time tracking',
                enables: 'Daily attendance logs, shift hours, and leave tracking',
                is_core: 0,
                deps: ['employee_management']
            },
            {
                code: 'payroll',
                name: 'Payroll',
                desc: 'Monthly salary calculation, allowances, deductions, and salary pay slips',
                enables: 'Automated payroll generation and double-entry salary expense entries',
                is_core: 0,
                deps: ['employee_management']
            },
            {
                code: 'whatsapp_integration',
                name: 'WhatsApp Integration',
                desc: 'Automated receipt PDF and payment confirmation dispatch via WhatsApp',
                enables: 'Sending digital receipts, khata statements, and low-stock alerts via WhatsApp',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'online_orders',
                name: 'Online Orders',
                desc: 'Intake and order management for web and mobile delivery channels',
                enables: 'Receiving online delivery orders directly into the POS kitchen/dispatch queue',
                is_core: 0,
                deps: ['sales']
            },
            {
                code: 'cloud_backup',
                name: 'Cloud Backup',
                desc: 'Automated encrypted offsite backup snapshots to secure cloud storage',
                enables: 'Scheduled cloud backup synchronization for disaster recovery',
                is_core: 0,
                deps: ['backup_restore']
            },
            {
                code: 'advanced_analytics',
                name: 'Advanced Analytics',
                desc: 'Gross margin trends, customer purchase heatmaps, and demand forecasting',
                enables: 'Predictive inventory replenishment and executive profitability metrics',
                is_core: 0,
                deps: ['reports']
            }
        ];
        const upsertModDef = db.prepare(`
      INSERT INTO module_definitions (id, module_code, module_name, description, enables, is_core, dependencies)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module_code) DO UPDATE SET
        module_name = excluded.module_name,
        description = excluded.description,
        enables = excluded.enables,
        is_core = excluded.is_core,
        dependencies = excluded.dependencies
    `);
        const upsertInstall = db.prepare(`
      INSERT INTO module_installations (id, module_id, installed_version, installation_status)
      VALUES (?, ?, '1.0.0', 'INSTALLED')
      ON CONFLICT(module_id) DO UPDATE SET
        installation_status = 'INSTALLED'
    `);
        for (const m of fullModuleCatalog) {
            const existing = db.prepare('SELECT id FROM module_definitions WHERE module_code = ?').get(m.code);
            const modId = existing ? existing.id : crypto_1.default.randomUUID();
            const depsJson = m.deps ? JSON.stringify(m.deps) : null;
            upsertModDef.run(modId, m.code, m.name, m.desc, m.enables, m.is_core, depsJson);
            upsertInstall.run(crypto_1.default.randomUUID(), modId);
        }
        // -----------------------------------------------------------------------
        // 4. RECORD MIGRATION 7
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(7, '007_module_installations_and_events');
    });
    tx();
}
