"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.posApi = void 0;
const electron_1 = require("electron");
const ipc_channels_1 = require("../../src/shared/contracts/ipc-channels");
async function invoke(channel, payload) {
    const response = await electron_1.ipcRenderer.invoke(channel, payload);
    if (!response.success) {
        throw new Error(response.error || `IPC call to ${channel} failed`);
    }
    return response.data;
}
exports.posApi = {
    // Auth
    auth: {
        login: (username, passwordPlain) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_LOGIN, { username, password: passwordPlain }),
        getCurrentUser: () => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_GET_CURRENT_USER),
        listUsers: () => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_LIST_USERS),
        createUser: (data) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_CREATE_USER, data),
        updatePassword: (userId, newPasswordPlain) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_UPDATE_PASSWORD, { userId, newPassword: newPasswordPlain })
    },
    // Sales & POS Terminal
    sales: {
        calculate: (items, orderDiscountPercent = 0, orderDiscountAmount = 0) => invoke(ipc_channels_1.IPC_CHANNELS.SALES_CALCULATE, { items, orderDiscountPercent, orderDiscountAmount }),
        createSale: (request) => invoke(ipc_channels_1.IPC_CHANNELS.SALES_CREATE, request),
        getSaleById: (id) => invoke(ipc_channels_1.IPC_CHANNELS.SALES_GET_BY_ID, id),
        listSales: (limit = 100) => invoke(ipc_channels_1.IPC_CHANNELS.SALES_LIST, limit),
        voidSale: (id, cashierId) => invoke(ipc_channels_1.IPC_CHANNELS.SALES_VOID, { id, cashierId })
    },
    // Inventory & Catalog
    inventory: {
        listProducts: () => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_LIST_PRODUCTS),
        searchProducts: (query) => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_SEARCH, query),
        getProductByBarcode: (barcode) => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_GET_BY_BARCODE, barcode),
        saveProduct: (product) => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_SAVE_PRODUCT, product),
        adjustStock: (request) => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_ADJUST_STOCK, request),
        listCategories: () => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_LIST_CATEGORIES),
        saveCategory: (name, description) => invoke(ipc_channels_1.IPC_CHANNELS.INVENTORY_SAVE_CATEGORY, { name, description })
    },
    // Customers
    customers: {
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_LIST),
        search: (query) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SEARCH, query),
        save: (customer) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SAVE, customer),
        getLedger: (customerId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_LEDGER, customerId),
        recordPayment: (customerId, amountPaid, notes) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, { customerId, amountPaid, notes })
    },
    // Suppliers
    suppliers: {
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_LIST),
        search: (query) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SEARCH, query),
        save: (supplier) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SAVE, supplier),
        getLedger: (supplierId) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_LEDGER, supplierId),
        recordPayment: (supplierId, amountPaid, notes) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, { supplierId, amountPaid, notes })
    },
    // Purchases
    purchases: {
        create: (request) => invoke(ipc_channels_1.IPC_CHANNELS.PURCHASES_CREATE, request),
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.PURCHASES_LIST)
    },
    // Accounts & Ledgers
    accounts: {
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_LIST),
        getJournalEntries: (limit = 100) => invoke(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_JOURNAL_ENTRIES, limit),
        createManualEntry: (params) => invoke(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_CREATE_ENTRY, params),
        getTrialBalance: () => invoke(ipc_channels_1.IPC_CHANNELS.ACCOUNTS_TRIAL_BALANCE)
    },
    // Expenses
    expenses: {
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.EXPENSES_LIST),
        listCategories: () => invoke(ipc_channels_1.IPC_CHANNELS.EXPENSES_CATEGORIES),
        create: (expense) => invoke(ipc_channels_1.IPC_CHANNELS.EXPENSES_CREATE, expense)
    },
    // Employees & Payroll
    employees: {
        list: () => invoke(ipc_channels_1.IPC_CHANNELS.EMPLOYEES_LIST),
        save: (employee) => invoke(ipc_channels_1.IPC_CHANNELS.EMPLOYEES_SAVE, employee),
        runPayroll: (params) => invoke(ipc_channels_1.IPC_CHANNELS.PAYROLL_RUN, params),
        listPayrollHistory: () => invoke(ipc_channels_1.IPC_CHANNELS.PAYROLL_LIST)
    },
    // Reports
    reports: {
        getDashboardStats: () => invoke(ipc_channels_1.IPC_CHANNELS.REPORTS_DASHBOARD),
        getDailyZReport: (dateString) => invoke(ipc_channels_1.IPC_CHANNELS.REPORTS_DAILY_Z, dateString),
        getProfitLossReport: (dateString) => invoke(ipc_channels_1.IPC_CHANNELS.REPORTS_PROFIT_LOSS, dateString),
        getStockValuationReport: () => invoke(ipc_channels_1.IPC_CHANNELS.REPORTS_STOCK_VALUATION)
    },
    // System Settings
    settings: {
        get: () => invoke(ipc_channels_1.IPC_CHANNELS.SETTINGS_GET),
        save: (settings) => invoke(ipc_channels_1.IPC_CHANNELS.SETTINGS_SAVE, settings)
    },
    // Printing
    printing: {
        printReceipt: (sale) => invoke(ipc_channels_1.IPC_CHANNELS.PRINTING_RECEIPT, sale),
        getPrinters: () => invoke(ipc_channels_1.IPC_CHANNELS.PRINTING_GET_PRINTERS)
    },
    // Backup & Restore
    backup: {
        create: (destinationDir) => invoke(ipc_channels_1.IPC_CHANNELS.BACKUP_CREATE, destinationDir),
        list: (backupDir) => invoke(ipc_channels_1.IPC_CHANNELS.BACKUP_LIST, backupDir),
        restore: (filePath) => invoke(ipc_channels_1.IPC_CHANNELS.BACKUP_RESTORE, filePath)
    }
};
electron_1.contextBridge.exposeInMainWorld('posApi', exports.posApi);
