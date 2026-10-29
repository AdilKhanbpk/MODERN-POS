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
        login: (username, passwordPlain, deviceIdentifier) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_LOGIN, { username, password: passwordPlain, deviceIdentifier }),
        verifySession: (sessionToken) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_VERIFY_SESSION, sessionToken),
        logout: (sessionToken) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_LOGOUT, sessionToken),
        getCurrentUser: () => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_GET_CURRENT_USER),
        listUsers: () => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_LIST_USERS),
        createUser: (data) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_CREATE_USER, data),
        updatePassword: (userId, newPasswordPlain) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_UPDATE_PASSWORD, { userId, newPassword: newPasswordPlain }),
        changePassword: (userId, currentPasswordPlain, newPasswordPlain) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { userId, currentPasswordPlain, newPasswordPlain }),
        adminResetPassword: (targetUserId, newPasswordPlain, sessionToken) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_ADMIN_RESET_PASSWORD, { targetUserId, newPasswordPlain, sessionToken }),
        revokeSession: (sessionId, sessionToken) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_REVOKE_SESSION, { sessionId, sessionToken }),
        revokeAllUserSessions: (userId, sessionToken) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_REVOKE_ALL_SESSIONS, { userId, sessionToken }),
        getUserPermissions: (userId, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.AUTH_GET_PERMISSIONS, { userId, businessId })
    },
    // Approvals & Overrides
    approvals: {
        request: (sessionToken, request) => invoke(ipc_channels_1.IPC_CHANNELS.APPROVALS_REQUEST, { sessionToken, request }),
        decide: (sessionToken, requestId, decision, reason) => invoke(ipc_channels_1.IPC_CHANNELS.APPROVALS_DECIDE, { sessionToken, requestId, decision, reason }),
        listPending: (sessionToken, branchId) => invoke(ipc_channels_1.IPC_CHANNELS.APPROVALS_LIST_PENDING, { sessionToken, branchId }),
        getRequest: (requestId) => invoke(ipc_channels_1.IPC_CHANNELS.APPROVALS_GET_REQUEST, requestId)
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
        list: (options) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_LIST, options),
        getById: (id, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_BY_ID, { id, businessId }),
        search: (query) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SEARCH, query),
        save: (customer) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SAVE, customer),
        update: (id, dto, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_UPDATE, { id, dto, businessId }),
        getLedger: (customerId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_LEDGER, customerId),
        recordPayment: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, payload),
        checkCredit: (customerId, newCreditMinor, businessId, hasApproval) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_CHECK_CREDIT, { customerId, newCreditMinor, businessId, hasApproval }),
        getStatement: (customerId, businessId, fromDate, toDate) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_STATEMENT, { customerId, businessId, fromDate, toDate }),
        getOutstandingInvoices: (customerId, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_OUTSTANDING_INVOICES, { customerId, businessId }),
        allocatePayment: (dto) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_ALLOCATE_PAYMENT, dto),
        reconcile: (customerId, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECONCILE, { customerId, businessId })
    },
    // Suppliers
    suppliers: {
        list: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_LIST, payload),
        getById: (id) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_BY_ID, { id }),
        search: (query) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SEARCH, query),
        save: (supplier) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SAVE, supplier),
        update: (id, dto) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_UPDATE, { id, dto }),
        getLedger: (supplierId) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_LEDGER, supplierId),
        recordPayment: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, payload),
        reversePayment: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_REVERSE_PAYMENT, payload),
        getStatement: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_STATEMENT, payload),
        getOutstandingInvoices: (supplierId) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_OUTSTANDING_INVOICES, { supplierId }),
        recordReturn: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_RETURN, payload),
        recordAdjustment: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_ADJUSTMENT, payload),
        reconcile: (supplierId) => invoke(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECONCILE, { supplierId })
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
    },
    // Onboarding & Setup
    onboarding: {
        getStatus: () => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_STATUS),
        saveDraft: (draft) => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_SAVE_DRAFT, draft),
        getDraft: () => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_DRAFT),
        clearDraft: () => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_CLEAR_DRAFT),
        getModuleDefinitions: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_MODULE_DEFINITIONS, businessId),
        complete: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_COMPLETE, payload),
        updateModuleStatus: (params) => invoke(ipc_channels_1.IPC_CHANNELS.ONBOARDING_UPDATE_MODULE, params)
    },
    // Modules & Optional Framework
    modules: {
        getNavigation: (businessId, userPermissions = []) => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_GET_NAVIGATION, { businessId, userPermissions }),
        listAll: () => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_LIST),
        getStatusList: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_STATUS_LIST, { businessId }),
        enable: (businessId, moduleCode, userId) => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_ENABLE, { businessId, moduleCode, userId }),
        disable: (businessId, moduleCode, userId) => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_DISABLE, { businessId, moduleCode, userId }),
        getEvents: (businessId, moduleCode) => invoke(ipc_channels_1.IPC_CHANNELS.MODULES_EVENTS, { businessId, moduleCode })
    },
    // Product Catalogue (Prompt 6)
    catalogue: {
        createProduct: (dto, userId) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE, { dto, userId }),
        updateProduct: (id, dto, userId) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_UPDATE, { id, dto, userId }),
        archiveProduct: (businessId, id) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_ARCHIVE, { businessId, id }),
        deleteProduct: (businessId, id) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_DELETE, { businessId, id }),
        duplicateProduct: (businessId, id, newSku, newName) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_DUPLICATE, { businessId, id, newSku, newName }),
        searchProducts: (params) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_SEARCH, params),
        getProductById: (businessId, id) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_GET_BY_ID, { businessId, id }),
        listCategories: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_LIST_CATEGORIES, { businessId }),
        createCategory: (dto) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE_CATEGORY, dto),
        updateCategory: (id, businessId, dto) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_UPDATE_CATEGORY, { id, businessId, dto }),
        listBrands: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_LIST_BRANDS, { businessId }),
        createBrand: (dto) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE_BRAND, dto),
        setPrice: (dto) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_SET_PRICE, dto),
        getPrices: (businessId, productId) => invoke(ipc_channels_1.IPC_CHANNELS.PRODUCTS_GET_PRICES, { businessId, productId })
    },
    // Units & Unit Conversions (Prompt 7)
    units: {
        listUnits: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_LIST, { businessId }),
        createUnit: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_CREATE, { dto, actor }),
        getConversions: (productId) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_GET_CONVERSIONS, { productId }),
        saveConversion: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_SAVE_CONVERSION, { dto, actor }),
        convertToBase: (productId, enteredQuantity, enteredUnitId) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_TO_BASE, { productId, enteredQuantity, enteredUnitId }),
        convertFromBase: (productId, baseQuantity, targetUnitId) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_FROM_BASE, { productId, baseQuantity, targetUnitId }),
        convertPrice: (productId, fromUnitId, toUnitId, priceMinor, roundingMode) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_PRICE, { productId, fromUnitId, toUnitId, priceMinor, roundingMode }),
        calculateReturn: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.UNITS_CALCULATE_RETURN, payload)
    },
    // Barcodes & Scale Profiles (Prompt 8)
    barcodes: {
        lookup: (businessId, barcode) => invoke(ipc_channels_1.IPC_CHANNELS.BARCODES_LOOKUP, { businessId, barcode }),
        addBarcode: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.BARCODES_ADD, { dto, actor }),
        setPrimary: (businessId, productId, barcodeId) => invoke(ipc_channels_1.IPC_CHANNELS.BARCODES_SET_PRIMARY, { businessId, productId, barcodeId }),
        deactivate: (businessId, barcodeId) => invoke(ipc_channels_1.IPC_CHANNELS.BARCODES_DEACTIVATE, { businessId, barcodeId }),
        listProductBarcodes: (productId) => invoke(ipc_channels_1.IPC_CHANNELS.BARCODES_LIST_PRODUCT, { productId }),
        listScaleProfiles: (businessId) => invoke(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_LIST, { businessId }),
        createScaleProfile: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_CREATE, { dto, actor }),
        testScaleProfile: (barcode, profileIdOrProfile) => invoke(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_TEST, { barcode, profileIdOrProfile })
    },
    stockLocations: {
        list: (payload) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_LIST, payload),
        getById: (id, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_BY_ID, { id, businessId }),
        create: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_CREATE, { dto, actor }),
        update: (id, dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_UPDATE, { id, dto, actor }),
        archive: (id, actor) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_ARCHIVE, { id, actor }),
        getStock: (locationId, businessId, filter) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_STOCK, { locationId, businessId, filter }),
        getProductStock: (productId, businessId) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_PRODUCT_STOCK, { productId, businessId }),
        transfer: (dto, actor) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_TRANSFER, { dto, actor }),
        getMovements: (locationId, businessId, limit) => invoke(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_MOVEMENTS, { locationId, businessId, limit })
    }
};
electron_1.contextBridge.exposeInMainWorld('posApi', exports.posApi);
