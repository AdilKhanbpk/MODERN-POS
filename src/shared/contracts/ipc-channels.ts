export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_VERIFY_SESSION: 'auth:verify-session',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_CURRENT_USER: 'auth:get-current-user',
  AUTH_LIST_USERS: 'auth:list-users',
  AUTH_CREATE_USER: 'auth:create-user',
  AUTH_UPDATE_PASSWORD: 'auth:update-password',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_ADMIN_RESET_PASSWORD: 'auth:admin-reset-password',
  AUTH_REVOKE_SESSION: 'auth:revoke-session',
  AUTH_REVOKE_ALL_SESSIONS: 'auth:revoke-all-sessions',
  AUTH_GET_PERMISSIONS: 'auth:get-permissions',

  // Approvals
  APPROVALS_REQUEST: 'approvals:request',
  APPROVALS_DECIDE: 'approvals:decide',
  APPROVALS_LIST_PENDING: 'approvals:list-pending',
  APPROVALS_GET_REQUEST: 'approvals:get-request',

  // Sales & POS
  SALES_CALCULATE: 'sales:calculate',
  SALES_CREATE: 'sales:create',
  SALES_GET_BY_ID: 'sales:get-by-id',
  SALES_LIST: 'sales:list',
  SALES_VOID: 'sales:void',

  // Inventory
  INVENTORY_LIST_PRODUCTS: 'inventory:list-products',
  INVENTORY_SEARCH: 'inventory:search',
  INVENTORY_GET_BY_BARCODE: 'inventory:get-by-barcode',
  INVENTORY_SAVE_PRODUCT: 'inventory:save-product',
  INVENTORY_DELETE_PRODUCT: 'inventory:delete-product',
  INVENTORY_ADJUST_STOCK: 'inventory:adjust-stock',
  INVENTORY_LIST_CATEGORIES: 'inventory:list-categories',
  INVENTORY_SAVE_CATEGORY: 'inventory:save-category',

  // Product Catalogue (Prompt 6)
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_ARCHIVE: 'products:archive',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_DUPLICATE: 'products:duplicate',
  PRODUCTS_SEARCH: 'products:search',
  PRODUCTS_GET_BY_ID: 'products:get-by-id',
  PRODUCTS_LIST_CATEGORIES: 'products:list-categories',
  PRODUCTS_CREATE_CATEGORY: 'products:create-category',
  PRODUCTS_UPDATE_CATEGORY: 'products:update-category',
  PRODUCTS_LIST_BRANDS: 'products:list-brands',
  PRODUCTS_CREATE_BRAND: 'products:create-brand',
  PRODUCTS_SET_PRICE: 'products:set-price',
  PRODUCTS_GET_PRICES: 'products:get-prices',

  // Customers
  CUSTOMERS_LIST: 'customers:list',
  CUSTOMERS_GET_BY_ID: 'customers:get-by-id',
  CUSTOMERS_SEARCH: 'customers:search',
  CUSTOMERS_SAVE: 'customers:save',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_GET_LEDGER: 'customers:get-ledger',
  CUSTOMERS_RECORD_PAYMENT: 'customers:record-payment',
  CUSTOMERS_CHECK_CREDIT: 'customers:check-credit',
  CUSTOMERS_STATEMENT: 'customers:statement',
  CUSTOMERS_OUTSTANDING_INVOICES: 'customers:outstanding-invoices',
  CUSTOMERS_ALLOCATE_PAYMENT: 'customers:allocate-payment',
  CUSTOMERS_RECONCILE: 'customers:reconcile',

  // Suppliers
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_GET_BY_ID: 'suppliers:get-by-id',
  SUPPLIERS_SEARCH: 'suppliers:search',
  SUPPLIERS_SAVE: 'suppliers:save',
  SUPPLIERS_UPDATE: 'suppliers:update',
  SUPPLIERS_GET_LEDGER: 'suppliers:get-ledger',
  SUPPLIERS_RECORD_PAYMENT: 'suppliers:record-payment',
  SUPPLIERS_REVERSE_PAYMENT: 'suppliers:reverse-payment',
  SUPPLIERS_STATEMENT: 'suppliers:statement',
  SUPPLIERS_OUTSTANDING_INVOICES: 'suppliers:outstanding-invoices',
  SUPPLIERS_RECORD_RETURN: 'suppliers:record-return',
  SUPPLIERS_RECORD_ADJUSTMENT: 'suppliers:record-adjustment',
  SUPPLIERS_RECONCILE: 'suppliers:reconcile',

  // Purchases
  PURCHASES_CREATE: 'purchases:create',
  PURCHASES_LIST: 'purchases:list',

  // Accounts
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_JOURNAL_ENTRIES: 'accounts:journal-entries',
  ACCOUNTS_CREATE_ENTRY: 'accounts:create-entry',
  ACCOUNTS_TRIAL_BALANCE: 'accounts:trial-balance',

  // Expenses
  EXPENSES_LIST: 'expenses:list',
  EXPENSES_CATEGORIES: 'expenses:categories',
  EXPENSES_CREATE: 'expenses:create',

  // Employees & Payroll
  EMPLOYEES_LIST: 'employees:list',
  EMPLOYEES_SAVE: 'employees:save',
  PAYROLL_RUN: 'payroll:run',
  PAYROLL_LIST: 'payroll:list',

  // Reports
  REPORTS_DASHBOARD: 'reports:dashboard',
  REPORTS_DAILY_Z: 'reports:daily-z',
  REPORTS_PROFIT_LOSS: 'reports:profit-loss',
  REPORTS_STOCK_VALUATION: 'reports:stock-valuation',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',

  // Hardware & Printing
  PRINTING_RECEIPT: 'printing:receipt',
  PRINTING_GET_PRINTERS: 'printing:get-printers',

  // Backup & Restore
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_LIST: 'backup:list',

  // Onboarding & Setup
  ONBOARDING_GET_STATUS: 'onboarding:get-status',
  ONBOARDING_SAVE_DRAFT: 'onboarding:save-draft',
  ONBOARDING_GET_DRAFT: 'onboarding:get-draft',
  ONBOARDING_CLEAR_DRAFT: 'onboarding:clear-draft',
  ONBOARDING_GET_MODULE_DEFINITIONS: 'onboarding:get-module-definitions',
  ONBOARDING_COMPLETE: 'onboarding:complete',
  ONBOARDING_UPDATE_MODULE: 'onboarding:update-module',

  // Module Management & Framework
  MODULES_GET_NAVIGATION: 'modules:get-navigation',
  MODULES_LIST: 'modules:list',
  MODULES_ENABLE: 'modules:enable',
  MODULES_DISABLE: 'modules:disable',
  MODULES_STATUS_LIST: 'modules:status-list',
  MODULES_EVENTS: 'modules:events',

  // Units & Unit Conversions (Prompt 7)
  UNITS_LIST: 'units:list',
  UNITS_CREATE: 'units:create',
  UNITS_GET_CONVERSIONS: 'units:get-conversions',
  UNITS_SAVE_CONVERSION: 'units:save-conversion',
  UNITS_CONVERT_TO_BASE: 'units:convert-to-base',
  UNITS_CONVERT_FROM_BASE: 'units:convert-from-base',
  UNITS_CONVERT_PRICE: 'units:convert-price',
  UNITS_CALCULATE_RETURN: 'units:calculate-return',

  // Barcodes & Scale Profiles (Prompt 8)
  BARCODES_LOOKUP: 'barcodes:lookup',
  BARCODES_ADD: 'barcodes:add',
  BARCODES_SET_PRIMARY: 'barcodes:set-primary',
  BARCODES_DEACTIVATE: 'barcodes:deactivate',
  BARCODES_LIST_PRODUCT: 'barcodes:list-product',
  SCALE_PROFILES_LIST: 'scale-profiles:list',
  SCALE_PROFILES_CREATE: 'scale-profiles:create',
  SCALE_PROFILES_TEST: 'scale-profiles:test',

  // Stock Locations & Warehouses (Prompt 11)
  STOCK_LOCATIONS_LIST: 'stock-locations:list',
  STOCK_LOCATIONS_GET_BY_ID: 'stock-locations:get-by-id',
  STOCK_LOCATIONS_CREATE: 'stock-locations:create',
  STOCK_LOCATIONS_UPDATE: 'stock-locations:update',
  STOCK_LOCATIONS_ARCHIVE: 'stock-locations:archive',
  STOCK_LOCATIONS_GET_STOCK: 'stock-locations:get-stock',
  STOCK_LOCATIONS_GET_PRODUCT_STOCK: 'stock-locations:get-product-stock',
  STOCK_LOCATIONS_TRANSFER: 'stock-locations:transfer',
  STOCK_LOCATIONS_MOVEMENTS: 'stock-locations:movements'
};

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

