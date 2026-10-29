"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIONAL_MODULES = exports.CORE_MODULES = void 0;
exports.CORE_MODULES = [
    {
        code: 'business_setup',
        name: 'Business Setup',
        description: 'Core store configuration, regional currency, branch hierarchy, and settings',
        category: 'SETTINGS',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-settings', label: 'Settings', path: '/settings', order: 90, requiredPermission: 'settings.view' }
        ]
    },
    {
        code: 'authentication',
        name: 'Authentication',
        description: 'Security tokens, password hashing, roles, granular RBAC, and session management',
        category: 'SETTINGS',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-users', label: 'User Management', path: '/users', order: 85, requiredPermission: 'users.manage' }
        ]
    },
    {
        code: 'products',
        name: 'Products',
        description: 'Catalog master, SKUs, barcodes, pricing, and category classifications',
        category: 'INVENTORY',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-products', label: 'Products', path: '/inventory/products', order: 20, requiredPermission: 'products.view' }
        ]
    },
    {
        code: 'customers',
        name: 'Customers',
        description: 'Customer directory, contact records, and customer identification',
        category: 'SALES',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-customers', label: 'Customers', path: '/customers', order: 40, requiredPermission: 'customers.view' }
        ]
    },
    {
        code: 'suppliers',
        name: 'Suppliers',
        description: 'Supplier directory, vendor contacts, and purchasing sources',
        category: 'INVENTORY',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-suppliers', label: 'Suppliers', path: '/suppliers', order: 50, requiredPermission: 'suppliers.view' }
        ]
    },
    {
        code: 'units',
        name: 'Units',
        description: 'Measurement units, unit dimensions, precision scales, and conversion ratios',
        category: 'INVENTORY',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-units', label: 'Units of Measure', path: '/inventory/units', order: 25, requiredPermission: 'products.edit' }
        ]
    },
    {
        code: 'sales',
        name: 'Sales',
        description: 'POS register checkout, line item calculation, order discounts, and receipt generation',
        category: 'SALES',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-pos', label: 'POS Checkout', path: '/pos', order: 10, requiredPermission: 'sales.create' }
        ]
    },
    {
        code: 'purchases',
        name: 'Purchases',
        description: 'Purchase bills, landed cost inventory intake, and vendor stock replenishment',
        category: 'INVENTORY',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-purchases', label: 'Purchase Bills', path: '/purchases', order: 55, requiredPermission: 'purchases.create' }
        ]
    },
    {
        code: 'inventory_ledger',
        name: 'Inventory Ledger',
        description: 'Traceable stock movements, running stock balances, and physical count reconciliation',
        category: 'INVENTORY',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-ledger', label: 'Stock Movements', path: '/inventory/ledger', order: 30, requiredPermission: 'inventory.view' }
        ]
    },
    {
        code: 'payments',
        name: 'Payments',
        description: 'Payment collection, tender types (Cash, Bank, Wallet), and allocation tracking',
        category: 'ACCOUNTING',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-payments', label: 'Payment Records', path: '/accounting/payments', order: 60, requiredPermission: 'payments.create' }
        ]
    },
    {
        code: 'cash_register',
        name: 'Cash Register',
        description: 'Cash drawer tracking, shift opening floats, and closing cash reconciliation',
        category: 'SALES',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-cash-drawer', label: 'Cash Drawer', path: '/register/drawer', order: 15, requiredPermission: 'register.manage' }
        ]
    },
    {
        code: 'expenses',
        name: 'Expenses',
        description: 'Operating expenditure categories, expense vouchers, and drawer cash disbursements',
        category: 'ACCOUNTING',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-expenses', label: 'Store Expenses', path: '/accounting/expenses', order: 65, requiredPermission: 'expenses.manage' }
        ]
    },
    {
        code: 'reports',
        name: 'Reports',
        description: 'Sales performance, daily Z-report, inventory valuation, and tax summaries',
        category: 'ANALYTICS',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-reports', label: 'Reports Dashboard', path: '/reports', order: 80, requiredPermission: 'reports.view' }
        ]
    },
    {
        code: 'audit',
        name: 'Audit',
        description: 'Immutable append-only audit trail and administrative security logging',
        category: 'SETTINGS',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-audit', label: 'Audit Logs', path: '/audit', order: 95, requiredPermission: 'audit.view' }
        ]
    },
    {
        code: 'backup_restore',
        name: 'Backup and Restore',
        description: 'Local database snapshots, automatic shift closing backups, and recovery',
        category: 'SETTINGS',
        classification: 'CORE',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-backup', label: 'Backups', path: '/settings/backups', order: 99, requiredPermission: 'settings.edit' }
        ]
    }
];
exports.OPTIONAL_MODULES = [
    {
        code: 'batch_expiry',
        name: 'Batch and Expiry',
        description: 'Perishable lot tracking, manufacturing dates, and expiry date alerts',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['inventory_ledger'],
        navigation: [
            { id: 'nav-batch-expiry', label: 'Batch & Expiry', path: '/inventory/batches', order: 32, requiredPermission: 'inventory.view' }
        ]
    },
    {
        code: 'fefo',
        name: 'FEFO',
        description: 'First-Expiry-First-Out automated batch picking and stock rotation',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['batch_expiry']
    },
    {
        code: 'serial_tracking',
        name: 'Serial Number Tracking',
        description: 'Unique unit serialization and IMEI tracking for electronics and appliances',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['inventory_ledger'],
        navigation: [
            { id: 'nav-serial-tracking', label: 'Serial Numbers', path: '/inventory/serials', order: 33, requiredPermission: 'inventory.view' }
        ]
    },
    {
        code: 'warranty_repair',
        name: 'Warranty and Repair',
        description: 'Customer warranty claims, RMA tracking, and vendor repair job cards',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['serial_tracking'],
        navigation: [
            { id: 'nav-warranty-repair', label: 'Warranty & Repairs', path: '/service/repairs', order: 48, requiredPermission: 'service.manage' }
        ]
    },
    {
        code: 'product_variants',
        name: 'Product Variants',
        description: 'Size, color, and fit matrix for apparel, footwear, and cosmetics',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['products'],
        navigation: [
            { id: 'nav-variants', label: 'Variant Matrix', path: '/inventory/variants', order: 22, requiredPermission: 'products.edit' }
        ]
    },
    {
        code: 'weighing_scale',
        name: 'Weighing Scale Integration',
        description: 'Electronic hardware scale serial/USB streaming directly into checkout cart',
        category: 'HARDWARE',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: [],
        hardware: [
            { hardwareType: 'SCALE', description: 'Electronic USB/Serial Weighing Scale', required: true }
        ]
    },
    {
        code: 'scale_barcode_parsing',
        name: 'Scale Barcode Parsing',
        description: 'Embedded price and weight barcode parsing (EAN-13 in-store barcodes)',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['products']
    },
    {
        code: 'purchase_orders',
        name: 'Purchase Orders',
        description: 'Supplier purchase orders, delivery scheduling, and supplier approval',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['purchases'],
        navigation: [
            { id: 'nav-pos-orders', label: 'Purchase Orders', path: '/purchases/orders', order: 54, requiredPermission: 'purchases.create' }
        ]
    },
    {
        code: 'goods_receiving',
        name: 'Goods Receiving',
        description: 'Warehouse goods receipt notes (GRN) and multi-step delivery verification',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['purchases', 'inventory_ledger'],
        navigation: [
            { id: 'nav-grn', label: 'Goods Receiving (GRN)', path: '/inventory/grn', order: 56, requiredPermission: 'purchases.create' }
        ]
    },
    {
        code: 'stock_transfers',
        name: 'Stock Transfers',
        description: 'Inter-branch and inter-warehouse stock transfer orders and dispatch tracking',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['inventory_ledger'],
        navigation: [
            { id: 'nav-transfers', label: 'Stock Transfers', path: '/inventory/transfers', order: 36, requiredPermission: 'inventory.adjust' }
        ]
    },
    {
        code: 'multiple_warehouses',
        name: 'Multiple Warehouses',
        description: 'Managing distinct storage warehouses, back rooms, and retail shelves',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['inventory_ledger'],
        navigation: [
            { id: 'nav-warehouses', label: 'Warehouses', path: '/inventory/warehouses', order: 37, requiredPermission: 'settings.edit' }
        ]
    },
    {
        code: 'wholesale_pricing',
        name: 'Wholesale Pricing',
        description: 'Tiered volume pricing, wholesale dealer rates, and customer group discounts',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['products']
    },
    {
        code: 'customer_credit',
        name: 'Customer Credit',
        description: 'Customer credit limits, accounts receivable ledger, and running khata statements',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['customers'],
        navigation: [
            { id: 'nav-customer-credit', label: 'Customer Khata / Credit', path: '/customers/credit', order: 42, requiredPermission: 'customers.view' }
        ]
    },
    {
        code: 'loyalty',
        name: 'Loyalty',
        description: 'Customer points accumulation, loyalty tiers, and points redemption',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['customers'],
        navigation: [
            { id: 'nav-loyalty', label: 'Loyalty Program', path: '/customers/loyalty', order: 44, requiredPermission: 'customers.view' }
        ]
    },
    {
        code: 'promotions',
        name: 'Promotions',
        description: 'Buy-One-Get-One (BOGO), combo deals, and scheduled promotional discounts',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales'],
        navigation: [
            { id: 'nav-promotions', label: 'Promotions & Deals', path: '/sales/promotions', order: 12, requiredPermission: 'discounts.apply' }
        ]
    },
    {
        code: 'quotations',
        name: 'Quotations',
        description: 'Price quotation drafting, customer estimates, and one-click quote-to-sale conversion',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales'],
        navigation: [
            { id: 'nav-quotations', label: 'Quotations', path: '/sales/quotations', order: 11, requiredPermission: 'sales.create' }
        ]
    },
    {
        code: 'sales_orders',
        name: 'Sales Orders',
        description: 'Advance customer orders, partial payment booking, and future delivery fulfillment',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales'],
        navigation: [
            { id: 'nav-sales-orders', label: 'Sales Orders', path: '/sales/orders', order: 13, requiredPermission: 'sales.create' }
        ]
    },
    {
        code: 'reservations',
        name: 'Reservations',
        description: 'Reserving stock for layaway or pending customer pickup without billing',
        category: 'INVENTORY',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['inventory_ledger'],
        navigation: [
            { id: 'nav-reservations', label: 'Stock Reservations', path: '/inventory/reservations', order: 34, requiredPermission: 'inventory.view' }
        ]
    },
    {
        code: 'multi_counter',
        name: 'Multi-Counter',
        description: 'Multiple simultaneous checkout terminals linked to shared local database',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['cash_register'],
        navigation: [
            { id: 'nav-counters', label: 'Counters & Terminals', path: '/settings/counters', order: 91, requiredPermission: 'settings.edit' }
        ]
    },
    {
        code: 'multi_branch',
        name: 'Multi-Branch',
        description: 'Multiple physical store branches with central PostgreSQL synchronization',
        category: 'SETTINGS',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['business_setup'],
        navigation: [
            { id: 'nav-branches', label: 'Store Branches', path: '/settings/branches', order: 92, requiredPermission: 'settings.edit' }
        ]
    },
    {
        code: 'tax_extensions',
        name: 'Tax Extensions',
        description: 'Multi-tier VAT/GST rates, tax exemptions, and FBR POS fiscal invoicing',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales'],
        navigation: [
            { id: 'nav-tax-config', label: 'Tax Settings', path: '/settings/taxes', order: 93, requiredPermission: 'settings.edit' }
        ]
    },
    {
        code: 'employee_management',
        name: 'Employee Management',
        description: 'Staff directory, job positions, employment terms, and compensation baselines',
        category: 'HR',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: [],
        navigation: [
            { id: 'nav-staff', label: 'Employees', path: '/hr/employees', order: 70, requiredPermission: 'users.manage' }
        ]
    },
    {
        code: 'attendance',
        name: 'Attendance',
        description: 'Employee daily biometric/manual clock-in and work shift time tracking',
        category: 'HR',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['employee_management'],
        hardware: [
            { hardwareType: 'BIOMETRIC', description: 'Biometric Fingerprint Scanner', required: false }
        ],
        navigation: [
            { id: 'nav-attendance', label: 'Attendance', path: '/hr/attendance', order: 71, requiredPermission: 'users.manage' }
        ]
    },
    {
        code: 'payroll',
        name: 'Payroll',
        description: 'Monthly salary calculation, allowances, deductions, and salary pay slips',
        category: 'HR',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['employee_management'],
        navigation: [
            { id: 'nav-payroll', label: 'Payroll & Salaries', path: '/hr/payroll', order: 72, requiredPermission: 'accounting.view' }
        ]
    },
    {
        code: 'whatsapp_integration',
        name: 'WhatsApp Integration',
        description: 'Automated receipt PDF and payment confirmation dispatch via WhatsApp',
        category: 'INTEGRATION',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales']
    },
    {
        code: 'online_orders',
        name: 'Online Orders',
        description: 'Intake and order management for web and mobile delivery channels',
        category: 'SALES',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['sales'],
        navigation: [
            { id: 'nav-online-orders', label: 'Online Orders Queue', path: '/sales/online-orders', order: 14, requiredPermission: 'sales.create' }
        ]
    },
    {
        code: 'cloud_backup',
        name: 'Cloud Backup',
        description: 'Automated encrypted offsite backup snapshots to secure cloud storage',
        category: 'INTEGRATION',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['backup_restore']
    },
    {
        code: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Gross margin trends, customer purchase heatmaps, and demand forecasting',
        category: 'ANALYTICS',
        classification: 'OPTIONAL',
        version: '1.0.0',
        dependencies: ['reports'],
        navigation: [
            { id: 'nav-adv-analytics', label: 'Advanced Analytics', path: '/reports/analytics', order: 82, requiredPermission: 'reports.view' }
        ]
    }
];
