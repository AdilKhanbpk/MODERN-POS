import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc-channels';
import { AuthService } from '../../../src/application/services/AuthService';
import { SalesService } from '../../../src/application/services/SalesService';
import { InventoryService } from '../../../src/application/services/InventoryService';
import { AccountService } from '../../../src/application/services/AccountService';
import { ExpenseService } from '../../../src/application/services/ExpenseService';
import { PayrollService } from '../../../src/application/services/PayrollService';
import { ReportService } from '../../../src/application/services/ReportService';
import { BackupService } from '../../../src/application/services/BackupService';
import { SettingsService } from '../../../src/application/services/SettingsService';
import { CustomerRepository } from '../../../src/infrastructure/sqlite/repositories/CustomerRepository';
import { SupplierRepository } from '../../../src/infrastructure/sqlite/repositories/SupplierRepository';
import { ThermalPrinterService } from '../printing/thermal-printer';
import {
  LoginSchema,
  CreateSaleSchema,
  ProductSchema,
  CustomerSchema,
  SupplierSchema,
  StockAdjustmentSchema,
  ExpenseSchema
} from '../../../src/shared/validators/schemas';

export function registerIpcHandlers(): void {
  const authService = new AuthService();
  const salesService = new SalesService();
  const inventoryService = new InventoryService();
  const accountService = new AccountService();
  const expenseService = new ExpenseService();
  const payrollService = new PayrollService();
  const reportService = new ReportService();
  const backupService = new BackupService();
  const settingsService = new SettingsService();
  const customerRepo = new CustomerRepository();
  const supplierRepo = new SupplierRepository();
  const printerService = new ThermalPrinterService();

  // Helper for safe IPC handler wrapping
  function handle<T, R>(channel: string, fn: (payload: T) => Promise<R> | R) {
    ipcMain.handle(channel, async (_event, payload: T) => {
      try {
        const result = await fn(payload);
        return { success: true, data: result };
      } catch (err: any) {
        console.error(`[IPC Error: ${channel}]`, err);
        return { success: false, error: err.message || 'Internal error' };
      }
    });
  }

  // --- Auth Handlers ---
  handle(IPC_CHANNELS.AUTH_LOGIN, (payload: any) => {
    const validated = LoginSchema.parse(payload);
    return authService.login(validated.username, validated.password);
  });

  handle(IPC_CHANNELS.AUTH_GET_CURRENT_USER, () => {
    return authService.getCurrentUser();
  });

  handle(IPC_CHANNELS.AUTH_LIST_USERS, () => {
    return authService.listUsers();
  });

  handle(IPC_CHANNELS.AUTH_CREATE_USER, (payload: any) => {
    return authService.createUser(payload);
  });

  handle(IPC_CHANNELS.AUTH_UPDATE_PASSWORD, (payload: any) => {
    authService.updatePassword(payload.userId, payload.newPassword);
    return true;
  });

  // --- Sales & POS Handlers ---
  handle(IPC_CHANNELS.SALES_CALCULATE, (payload: any) => {
    return salesService.calculate(payload.items, payload.orderDiscountPercent, payload.orderDiscountAmount);
  });

  handle(IPC_CHANNELS.SALES_CREATE, (payload: any) => {
    const validated = CreateSaleSchema.parse(payload);
    return salesService.createSale(validated as any);
  });

  handle(IPC_CHANNELS.SALES_GET_BY_ID, (id: number) => {
    return salesService.getSaleById(id);
  });

  handle(IPC_CHANNELS.SALES_LIST, (limit: number) => {
    return salesService.listSales(limit || 100);
  });

  handle(IPC_CHANNELS.SALES_VOID, (payload: { id: number; cashierId: number }) => {
    salesService.voidSale(payload.id, payload.cashierId);
    return true;
  });

  // --- Inventory Handlers ---
  handle(IPC_CHANNELS.INVENTORY_LIST_PRODUCTS, () => {
    return inventoryService.listProducts();
  });

  handle(IPC_CHANNELS.INVENTORY_SEARCH, (query: string) => {
    return inventoryService.searchProducts(query);
  });

  handle(IPC_CHANNELS.INVENTORY_GET_BY_BARCODE, (barcode: string) => {
    return inventoryService.getProductByBarcode(barcode);
  });

  handle(IPC_CHANNELS.INVENTORY_SAVE_PRODUCT, (payload: any) => {
    const validated = ProductSchema.parse(payload);
    return inventoryService.saveProduct(validated as any);
  });

  handle(IPC_CHANNELS.INVENTORY_ADJUST_STOCK, (payload: any) => {
    const validated = StockAdjustmentSchema.parse(payload);
    return inventoryService.adjustStock(validated as any);
  });

  handle(IPC_CHANNELS.INVENTORY_LIST_CATEGORIES, () => {
    return inventoryService.listCategories();
  });

  handle(IPC_CHANNELS.INVENTORY_SAVE_CATEGORY, (payload: { name: string; description?: string }) => {
    return inventoryService.createCategory(payload.name, payload.description);
  });

  // --- Customers Handlers ---
  handle(IPC_CHANNELS.CUSTOMERS_LIST, () => {
    return customerRepo.list();
  });

  handle(IPC_CHANNELS.CUSTOMERS_SEARCH, (query: string) => {
    return customerRepo.search(query);
  });

  handle(IPC_CHANNELS.CUSTOMERS_SAVE, (payload: any) => {
    const validated = CustomerSchema.parse(payload);
    return customerRepo.create(validated as any);
  });

  handle(IPC_CHANNELS.CUSTOMERS_GET_LEDGER, (customerId: number) => {
    return customerRepo.getLedger(customerId);
  });

  handle(IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, (payload: any) => {
    accountService.recordCustomerPayment(payload);
    return true;
  });

  // --- Suppliers Handlers ---
  handle(IPC_CHANNELS.SUPPLIERS_LIST, () => {
    return supplierRepo.list();
  });

  handle(IPC_CHANNELS.SUPPLIERS_SEARCH, (query: string) => {
    return supplierRepo.search(query);
  });

  handle(IPC_CHANNELS.SUPPLIERS_SAVE, (payload: any) => {
    const validated = SupplierSchema.parse(payload);
    return supplierRepo.create(validated as any);
  });

  handle(IPC_CHANNELS.SUPPLIERS_GET_LEDGER, (supplierId: number) => {
    return supplierRepo.getLedger(supplierId);
  });

  handle(IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, (payload: any) => {
    accountService.recordSupplierPayment(payload);
    return true;
  });

  // --- Accounts Handlers ---
  handle(IPC_CHANNELS.ACCOUNTS_LIST, () => {
    return accountService.getAccounts();
  });

  handle(IPC_CHANNELS.ACCOUNTS_JOURNAL_ENTRIES, (limit: number) => {
    return accountService.getJournalEntries(limit);
  });

  handle(IPC_CHANNELS.ACCOUNTS_CREATE_ENTRY, (payload: any) => {
    return accountService.createManualJournalEntry(payload);
  });

  handle(IPC_CHANNELS.ACCOUNTS_TRIAL_BALANCE, () => {
    return accountService.getTrialBalance();
  });

  // --- Expenses Handlers ---
  handle(IPC_CHANNELS.EXPENSES_LIST, () => {
    return expenseService.listExpenses();
  });

  handle(IPC_CHANNELS.EXPENSES_CATEGORIES, () => {
    return expenseService.listCategories();
  });

  handle(IPC_CHANNELS.EXPENSES_CREATE, (payload: any) => {
    const validated = ExpenseSchema.parse(payload);
    return expenseService.createExpense(validated as any);
  });

  // --- Employees & Payroll Handlers ---
  handle(IPC_CHANNELS.EMPLOYEES_LIST, () => {
    return payrollService.listEmployees();
  });

  handle(IPC_CHANNELS.EMPLOYEES_SAVE, (payload: any) => {
    return payrollService.saveEmployee(payload);
  });

  handle(IPC_CHANNELS.PAYROLL_RUN, (payload: any) => {
    return payrollService.runPayroll(payload);
  });

  handle(IPC_CHANNELS.PAYROLL_LIST, () => {
    return payrollService.listPayrollHistory();
  });

  // --- Reports Handlers ---
  handle(IPC_CHANNELS.REPORTS_DASHBOARD, () => {
    return reportService.getDashboardStats();
  });

  handle(IPC_CHANNELS.REPORTS_DAILY_Z, (dateString?: string) => {
    return reportService.getDailyZReport(dateString);
  });

  handle(IPC_CHANNELS.REPORTS_PROFIT_LOSS, (dateString?: string) => {
    return reportService.getProfitLossReport(dateString);
  });

  handle(IPC_CHANNELS.REPORTS_STOCK_VALUATION, () => {
    return reportService.getStockValuationReport();
  });

  // --- Settings Handlers ---
  handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return settingsService.getSettings();
  });

  handle(IPC_CHANNELS.SETTINGS_SAVE, (payload: any) => {
    return settingsService.saveSettings(payload);
  });

  // --- Printing Handlers ---
  handle(IPC_CHANNELS.PRINTING_RECEIPT, async (sale: any) => {
    return await printerService.printReceipt(sale);
  });

  handle(IPC_CHANNELS.PRINTING_GET_PRINTERS, async () => {
    return await printerService.getPrinters();
  });

  // --- Backup Handlers ---
  handle(IPC_CHANNELS.BACKUP_CREATE, (destinationDir?: string) => {
    return backupService.createBackup(destinationDir);
  });

  handle(IPC_CHANNELS.BACKUP_LIST, (backupDir?: string) => {
    return backupService.listBackups(backupDir);
  });

  handle(IPC_CHANNELS.BACKUP_RESTORE, (filePath: string) => {
    return backupService.restoreBackup(filePath);
  });
}

