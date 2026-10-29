"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV5 = applyMigrationV5;
function applyMigrationV5(db) {
    const tx = db.transaction(() => {
        // 1. Add 'enables' column to module_definitions if not present
        const cols = db.prepare("PRAGMA table_info(module_definitions)").all();
        if (!cols.some(c => c.name === 'enables')) {
            db.exec('ALTER TABLE module_definitions ADD COLUMN enables TEXT;');
        }
        // 2. Comprehensive Module Catalog with explicit dependencies and capabilities
        const moduleCatalog = [
            {
                id: '00000000-0000-0000-0000-000000000040',
                code: 'pos_checkout',
                name: 'POS Terminal & Cash Register',
                desc: 'Fast barcode scanning, cashier registers, bill discounts, and receipt printing',
                enables: 'Cashier checkout terminal, barcode scanner integration, and thermal receipt printing',
                is_core: 1,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000041',
                code: 'inventory_control',
                name: 'Inventory & Stock Ledger',
                desc: 'Traceable stock movements, running stock balances, and physical audit adjustments',
                enables: 'Real-time stock ledger, minimum reorder alerts, and physical audit adjustments',
                is_core: 1,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000044',
                code: 'general_accounting',
                name: 'Double-Entry Accounting',
                desc: 'General ledger journal entries, chart of accounts, and financial balance sheet',
                enables: 'Automated double-entry journals, cash/bank accounts, and financial balance sheet',
                is_core: 1,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000042',
                code: 'customer_ledger',
                name: 'Customer Credit & Khata Ledger',
                desc: 'Customer credit limits, accounts receivable ledger, and running balance statements',
                enables: 'Customer credit sales, running balance statements, and payment receipts',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000043',
                code: 'supplier_payables',
                name: 'Supplier Purchases & Accounts Payable',
                desc: 'Landed cost purchases, supplier ledger reconciliation, and vendor returns',
                enables: 'Purchase order receiving, supplier ledger reconciliation, and vendor payments',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000045',
                code: 'weighing_scale',
                name: 'Electronic Weighing Scale Integration',
                desc: 'Electronic hardware scale connectivity for loose produce, vegetables, and meat',
                enables: 'Live gross/net weight streaming directly into the POS cart via USB/serial',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000046',
                code: 'batch_expiry',
                name: 'Batch & Expiry Date Tracking',
                desc: 'Pharmaceutical and grocery lot numbers, manufacturing and expiry dates',
                enables: 'Perishable lot tracking, expiry alerts, and batch costing',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000050',
                code: 'fefo_picking',
                name: 'FEFO Automated Picking',
                desc: 'First-Expiry-First-Out picking engine for perishable pharmaceuticals and food',
                enables: 'Automatic checkout prioritization of earliest expiring batches to minimize spoilage',
                is_core: 0,
                dependencies: JSON.stringify(['batch_expiry'])
            },
            {
                id: '00000000-0000-0000-0000-000000000047',
                code: 'variant_matrix',
                name: 'Size, Color & Style Variant Matrix',
                desc: 'Apparel and footwear matrix for multi-dimensional SKU variant management',
                enables: 'Single product master with size/color/fit variant matrix and individual pricing',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000048',
                code: 'serial_warranty',
                name: 'Serial Number & Warranty Claims',
                desc: 'Electronics IMEI/serial number tracking, customer warranty claims, and vendor RMAs',
                enables: 'Tracking individual serialized units from intake to sale and customer warranty claims',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000051',
                code: 'service_history',
                name: 'Equipment Service & Repair History',
                desc: 'Equipment maintenance tickets, calibration history, and repair job cards',
                enables: 'Equipment service tickets, maintenance tracking, and warranty claim status',
                is_core: 0,
                dependencies: JSON.stringify(['serial_warranty'])
            },
            {
                id: '00000000-0000-0000-0000-000000000052',
                code: 'bulk_pricing',
                name: 'Tiered Bulk & Wholesale Pricing',
                desc: 'Wholesale quantity breaks, pack pricing, and customer tiered rates',
                enables: 'Automated wholesale volume discounts and multiple unit pricing tiers',
                is_core: 0,
                dependencies: null
            },
            {
                id: '00000000-0000-0000-0000-000000000049',
                code: 'branch_sync',
                name: 'Branch PostgreSQL Sync Engine',
                desc: 'Multi-branch background synchronization with centralized PostgreSQL server',
                enables: 'Cloud/central PostgreSQL multi-branch inventory and sales sync',
                is_core: 0,
                dependencies: null
            }
        ];
        const upsertStmt = db.prepare(`
      INSERT INTO module_definitions (id, module_code, module_name, description, enables, is_core, dependencies)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_code = excluded.module_code,
        module_name = excluded.module_name,
        description = excluded.description,
        enables = excluded.enables,
        is_core = excluded.is_core,
        dependencies = excluded.dependencies
    `);
        for (const m of moduleCatalog) {
            upsertStmt.run(m.id, m.code, m.name, m.desc, m.enables, m.is_core, m.dependencies);
        }
        // 3. Record migration version 5
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(5, '005_onboarding_module_catalog');
    });
    tx();
}
