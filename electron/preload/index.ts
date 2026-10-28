import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ApiResponse } from '../../src/shared/contracts/ipc-channels';
import {
  User, Customer, Supplier, Product, Sale, SaleCalculationResult,
  CreateSaleRequest, CreatePurchaseOrderRequest, PurchaseOrder,
  Account, JournalEntry, JournalEntryLine, Expense, Employee,
  PayrollRun, SystemSettings, DailyZReport, CartItemInput, StockAdjustmentRequest
} from '../../src/shared/types';
import { Role } from '../../src/shared/constants/roles-permissions';

async function invoke<T = any>(channel: string, payload?: any): Promise<T> {
  const response: ApiResponse<T> = await ipcRenderer.invoke(channel, payload);
  if (!response.success) {
    throw new Error(response.error || `IPC call to ${channel} failed`);
  }
  return response.data as T;
}

export const posApi = {
  // Auth
  auth: {
    login: (username: string, passwordPlain: string): Promise<User> =>
      invoke(IPC_CHANNELS.AUTH_LOGIN, { username, password: passwordPlain }),
    getCurrentUser: (): Promise<User | null> =>
      invoke(IPC_CHANNELS.AUTH_GET_CURRENT_USER),
    listUsers: (): Promise<User[]> =>
      invoke(IPC_CHANNELS.AUTH_LIST_USERS),
    createUser: (data: { username: string; passwordPlain: string; fullName: string; role: Role }): Promise<number> =>
      invoke(IPC_CHANNELS.AUTH_CREATE_USER, data),
    updatePassword: (userId: number, newPasswordPlain: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_UPDATE_PASSWORD, { userId, newPassword: newPasswordPlain })
  },

  // Sales & POS Terminal
  sales: {
    calculate: (items: CartItemInput[], orderDiscountPercent = 0, orderDiscountAmount = 0): Promise<SaleCalculationResult> =>
      invoke(IPC_CHANNELS.SALES_CALCULATE, { items, orderDiscountPercent, orderDiscountAmount }),
    createSale: (request: CreateSaleRequest): Promise<Sale> =>
      invoke(IPC_CHANNELS.SALES_CREATE, request),
    getSaleById: (id: number): Promise<Sale | null> =>
      invoke(IPC_CHANNELS.SALES_GET_BY_ID, id),
    listSales: (limit = 100): Promise<Sale[]> =>
      invoke(IPC_CHANNELS.SALES_LIST, limit),
    voidSale: (id: number, cashierId: number): Promise<boolean> =>
      invoke(IPC_CHANNELS.SALES_VOID, { id, cashierId })
  },

  // Inventory & Catalog
  inventory: {
    listProducts: (): Promise<Product[]> =>
      invoke(IPC_CHANNELS.INVENTORY_LIST_PRODUCTS),
    searchProducts: (query: string): Promise<Product[]> =>
      invoke(IPC_CHANNELS.INVENTORY_SEARCH, query),
    getProductByBarcode: (barcode: string): Promise<Product | null> =>
      invoke(IPC_CHANNELS.INVENTORY_GET_BY_BARCODE, barcode),
    saveProduct: (product: Omit<Product, 'createdAt' | 'units'>): Promise<number> =>
      invoke(IPC_CHANNELS.INVENTORY_SAVE_PRODUCT, product),
    adjustStock: (request: StockAdjustmentRequest): Promise<number> =>
      invoke(IPC_CHANNELS.INVENTORY_ADJUST_STOCK, request),
    listCategories: (): Promise<Array<{ id: number; name: string; description?: string }>> =>
      invoke(IPC_CHANNELS.INVENTORY_LIST_CATEGORIES),
    saveCategory: (name: string, description?: string): Promise<number> =>
      invoke(IPC_CHANNELS.INVENTORY_SAVE_CATEGORY, { name, description })
  },

  // Customers
  customers: {
    list: (): Promise<Customer[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_LIST),
    search: (query: string): Promise<Customer[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_SEARCH, query),
    save: (customer: any): Promise<number> =>
      invoke(IPC_CHANNELS.CUSTOMERS_SAVE, customer),
    getLedger: (customerId: number): Promise<any[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_GET_LEDGER, customerId),
    recordPayment: (customerId: number, amountPaid: number, notes?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, { customerId, amountPaid, notes })
  },

  // Suppliers
  suppliers: {
    list: (): Promise<Supplier[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_LIST),
    search: (query: string): Promise<Supplier[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_SEARCH, query),
    save: (supplier: any): Promise<number> =>
      invoke(IPC_CHANNELS.SUPPLIERS_SAVE, supplier),
    getLedger: (supplierId: number): Promise<any[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_GET_LEDGER, supplierId),
    recordPayment: (supplierId: number, amountPaid: number, notes?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, { supplierId, amountPaid, notes })
  },

  // Purchases
  purchases: {
    create: (request: CreatePurchaseOrderRequest): Promise<number> =>
      invoke(IPC_CHANNELS.PURCHASES_CREATE, request),
    list: (): Promise<PurchaseOrder[]> =>
      invoke(IPC_CHANNELS.PURCHASES_LIST)
  },

  // Accounts & Ledgers
  accounts: {
    list: (): Promise<Account[]> =>
      invoke(IPC_CHANNELS.ACCOUNTS_LIST),
    getJournalEntries: (limit = 100): Promise<JournalEntry[]> =>
      invoke(IPC_CHANNELS.ACCOUNTS_JOURNAL_ENTRIES, limit),
    createManualEntry: (params: { description: string; lines: JournalEntryLine[] }): Promise<number> =>
      invoke(IPC_CHANNELS.ACCOUNTS_CREATE_ENTRY, params),
    getTrialBalance: (): Promise<any[]> =>
      invoke(IPC_CHANNELS.ACCOUNTS_TRIAL_BALANCE)
  },

  // Expenses
  expenses: {
    list: (): Promise<Expense[]> =>
      invoke(IPC_CHANNELS.EXPENSES_LIST),
    listCategories: (): Promise<Array<{ id: number; name: string }>> =>
      invoke(IPC_CHANNELS.EXPENSES_CATEGORIES),
    create: (expense: any): Promise<number> =>
      invoke(IPC_CHANNELS.EXPENSES_CREATE, expense)
  },

  // Employees & Payroll
  employees: {
    list: (): Promise<Employee[]> =>
      invoke(IPC_CHANNELS.EMPLOYEES_LIST),
    save: (employee: any): Promise<number> =>
      invoke(IPC_CHANNELS.EMPLOYEES_SAVE, employee),
    runPayroll: (params: { employeeId: number; month: string; allowance: number; deduction: number }): Promise<number> =>
      invoke(IPC_CHANNELS.PAYROLL_RUN, params),
    listPayrollHistory: (): Promise<PayrollRun[]> =>
      invoke(IPC_CHANNELS.PAYROLL_LIST)
  },

  // Reports
  reports: {
    getDashboardStats: (): Promise<any> =>
      invoke(IPC_CHANNELS.REPORTS_DASHBOARD),
    getDailyZReport: (dateString?: string): Promise<DailyZReport> =>
      invoke(IPC_CHANNELS.REPORTS_DAILY_Z, dateString),
    getProfitLossReport: (dateString?: string): Promise<any> =>
      invoke(IPC_CHANNELS.REPORTS_PROFIT_LOSS, dateString),
    getStockValuationReport: (): Promise<any> =>
      invoke(IPC_CHANNELS.REPORTS_STOCK_VALUATION)
  },

  // System Settings
  settings: {
    get: (): Promise<SystemSettings> =>
      invoke(IPC_CHANNELS.SETTINGS_GET),
    save: (settings: Partial<SystemSettings>): Promise<SystemSettings> =>
      invoke(IPC_CHANNELS.SETTINGS_SAVE, settings)
  },

  // Printing
  printing: {
    printReceipt: (sale: Sale): Promise<{ success: boolean; message?: string }> =>
      invoke(IPC_CHANNELS.PRINTING_RECEIPT, sale),
    getPrinters: (): Promise<any[]> =>
      invoke(IPC_CHANNELS.PRINTING_GET_PRINTERS)
  },

  // Backup & Restore
  backup: {
    create: (destinationDir?: string): Promise<{ success: boolean; filePath: string; sizeBytes: number }> =>
      invoke(IPC_CHANNELS.BACKUP_CREATE, destinationDir),
    list: (backupDir?: string): Promise<Array<{ fileName: string; filePath: string; sizeBytes: number; createdAt: string }>> =>
      invoke(IPC_CHANNELS.BACKUP_LIST, backupDir),
    restore: (filePath: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.BACKUP_RESTORE, filePath)
  }
};

contextBridge.exposeInMainWorld('posApi', posApi);

export type PosApi = typeof posApi;

