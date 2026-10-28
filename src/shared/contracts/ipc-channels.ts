export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_GET_CURRENT_USER: 'auth:get-current-user',
  AUTH_LIST_USERS: 'auth:list-users',
  AUTH_CREATE_USER: 'auth:create-user',
  AUTH_UPDATE_PASSWORD: 'auth:update-password',

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

  // Customers
  CUSTOMERS_LIST: 'customers:list',
  CUSTOMERS_SEARCH: 'customers:search',
  CUSTOMERS_SAVE: 'customers:save',
  CUSTOMERS_GET_LEDGER: 'customers:get-ledger',
  CUSTOMERS_RECORD_PAYMENT: 'customers:record-payment',

  // Suppliers
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_SEARCH: 'suppliers:search',
  SUPPLIERS_SAVE: 'suppliers:save',
  SUPPLIERS_GET_LEDGER: 'suppliers:get-ledger',
  SUPPLIERS_RECORD_PAYMENT: 'suppliers:record-payment',

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
  BACKUP_LIST: 'backup:list'
} as const;

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

