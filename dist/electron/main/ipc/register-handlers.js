"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const ipc_channels_1 = require("../../../src/shared/contracts/ipc-channels");
const AuthService_1 = require("../../../src/application/services/AuthService");
const SalesService_1 = require("../../../src/application/services/SalesService");
const InventoryService_1 = require("../../../src/application/services/InventoryService");
const AccountService_1 = require("../../../src/application/services/AccountService");
const ExpenseService_1 = require("../../../src/application/services/ExpenseService");
const PayrollService_1 = require("../../../src/application/services/PayrollService");
const ReportService_1 = require("../../../src/application/services/ReportService");
const BackupService_1 = require("../../../src/application/services/BackupService");
const SettingsService_1 = require("../../../src/application/services/SettingsService");
const CustomerRepository_1 = require("../../../src/infrastructure/sqlite/repositories/CustomerRepository");
const SupplierRepository_1 = require("../../../src/infrastructure/sqlite/repositories/SupplierRepository");
const thermal_printer_1 = require("../printing/thermal-printer");
const schemas_1 = require("../../../src/shared/validators/schemas");
function registerIpcHandlers() {
    const authService = new AuthService_1.AuthService();
    const salesService = new SalesService_1.SalesService();
    const inventoryService = new InventoryService_1.InventoryService();
    const accountService = new AccountService_1.AccountService();
    const expenseService = new ExpenseService_1.ExpenseService();
    const payrollService = new PayrollService_1.PayrollService();
    const reportService = new ReportService_1.ReportService();
    const backupService = new BackupService_1.BackupService();
    const settingsService = new SettingsService_1.SettingsService();
    const customerRepo = new CustomerRepository_1.CustomerRepository();
    const supplierRepo = new SupplierRepository_1.SupplierRepository();
    const printerService = new thermal_printer_1.ThermalPrinterService();
    // Helper for safe IPC handler wrapping
    function handle(channel, fn) {
        electron_1.ipcMain.handle(channel, async (_event, payload) => {
            try {
                const result = await fn(payload);
                return { success: true, data: result };
            }
            catch (err) {
                console.error(`[IPC Error: ${channel}]`, err);
                return { success: false, error: err.message || 'Internal error' };
            }
        });
    }
    // --- Auth Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_LOGIN, (payload) => {
        const validated = schemas_1.LoginSchema.parse(payload);
        return authService.login(validated.username, validated.password);
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_GET_CURRENT_USER, () => {
        return authService.getCurrentUser();
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_LIST_USERS, () => {
        return authService.listUsers();
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_CREATE_USER, (payload) => {
        return authService.createUser(payload);
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_UPDATE_PASSWORD, (payload) => {
        authService.updatePassword(payload.userId, payload.newPassword);
        return true;
    });
    // --- Sales & POS Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.SALES_CALCULATE, (payload) => {
        return salesService.calculate(payload.items, payload.orderDiscountPercent, payload.orderDiscountAmount);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SALES_CREATE, (payload) => {
        const validated = schemas_1.CreateSaleSchema.parse(payload);
        return salesService.createSale(validated);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SALES_GET_BY_ID, (id) => {
        return salesService.getSaleById(id);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SALES_LIST, (limit) => {
        return salesService.listSales(limit || 100);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SALES_VOID, (payload) => {
        salesService.voidSale(payload.id, payload.cashierId);
        return true;
    });
    // --- Inventory Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_LIST_PRODUCTS, () => {
        return inventoryService.listProducts();
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_SEARCH, (query) => {
        return inventoryService.searchProducts(query);
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_GET_BY_BARCODE, (barcode) => {
        return inventoryService.getProductByBarcode(barcode);
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_SAVE_PRODUCT, (payload) => {
        const validated = schemas_1.ProductSchema.parse(payload);
        return inventoryService.saveProduct(validated);
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_ADJUST_STOCK, (payload) => {
        const validated = schemas_1.StockAdjustmentSchema.parse(payload);
        return inventoryService.adjustStock(validated);
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_LIST_CATEGORIES, () => {
        return inventoryService.listCategories();
    });
    handle(ipc_channels_1.IPC_CHANNELS.INVENTORY_SAVE_CATEGORY, (payload) => {
        return inventoryService.createCategory(payload.name, payload.description);
    });
    // --- Customers Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_LIST, () => {
        return customerRepo.list();
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SEARCH, (query) => {
        return customerRepo.search(query);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SAVE, (payload) => {
        const validated = schemas_1.CustomerSchema.parse(payload);
        return customerRepo.create(validated);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_LEDGER, (customerId) => {
        return customerRepo.getLedger(customerId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, (payload) => {
        accountService.recordCustomerPayment(payload);
        return true;
    });
    // --- Suppliers Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_LIST, () => {
        return supplierRepo.list();
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SEARCH, (query) => {
        return supplierRepo.search(query);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SAVE, (payload) => {
        const validated = schemas_1.SupplierSchema.parse(payload);
        return supplierRepo.create(validated);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_LEDGER, (supplierId) => {
        return supplierRepo.getLedger(supplierId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, (payload) => {
        accountService.recordSupplierPayment(payload);
        return true;
    });
    // --- Accounts Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_LIST, () => {
        return accountService.getAccounts();
    });
    handle(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_JOURNAL_ENTRIES, (limit) => {
        return accountService.getJournalEntries(limit);
    });
    handle(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_CREATE_ENTRY, (payload) => {
        return accountService.createManualJournalEntry(payload);
    });
    handle(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_TRIAL_BALANCE, () => {
        return accountService.getTrialBalance();
    });
    // --- Expenses Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.EXPENSES_LIST, () => {
        return expenseService.listExpenses();
    });
    handle(ipc_channels_1.IPC_CHANNELS.EXPENSES_CATEGORIES, () => {
        return expenseService.listCategories();
    });
    handle(ipc_channels_1.IPC_CHANNELS.EXPENSES_CREATE, (payload) => {
        const validated = schemas_1.ExpenseSchema.parse(payload);
        return expenseService.createExpense(validated);
    });
    // --- Employees & Payroll Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.EMPLOYEES_LIST, () => {
        return payrollService.listEmployees();
    });
    handle(ipc_channels_1.IPC_CHANNELS.EMPLOYEES_SAVE, (payload) => {
        return payrollService.saveEmployee(payload);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PAYROLL_RUN, (payload) => {
        return payrollService.runPayroll(payload);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PAYROLL_LIST, () => {
        return payrollService.listPayrollHistory();
    });
    // --- Reports Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.REPORTS_DASHBOARD, () => {
        return reportService.getDashboardStats();
    });
    handle(ipc_channels_1.IPC_CHANNELS.REPORTS_DAILY_Z, (dateString) => {
        return reportService.getDailyZReport(dateString);
    });
    handle(ipc_channels_1.IPC_CHANNELS.REPORTS_PROFIT_LOSS, (dateString) => {
        return reportService.getProfitLossReport(dateString);
    });
    handle(ipc_channels_1.IPC_CHANNELS.REPORTS_STOCK_VALUATION, () => {
        return reportService.getStockValuationReport();
    });
    // --- Settings Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.SETTINGS_GET, () => {
        return settingsService.getSettings();
    });
    handle(ipc_channels_1.IPC_CHANNELS.SETTINGS_SAVE, (payload) => {
        return settingsService.saveSettings(payload);
    });
    // --- Printing Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.PRINTING_RECEIPT, async (sale) => {
        return await printerService.printReceipt(sale);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRINTING_GET_PRINTERS, async () => {
        return await printerService.getPrinters();
    });
    // --- Backup Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.BACKUP_CREATE, (destinationDir) => {
        return backupService.createBackup(destinationDir);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BACKUP_LIST, (backupDir) => {
        return backupService.listBackups(backupDir);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BACKUP_RESTORE, (filePath) => {
        return backupService.restoreBackup(filePath);
    });
}
