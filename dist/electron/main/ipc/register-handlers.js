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
const OnboardingService_1 = require("../../../src/application/services/OnboardingService");
const ApprovalService_1 = require("../../../src/application/services/ApprovalService");
const RbacService_1 = require("../../../src/application/authorization/RbacService");
const ModuleManager_1 = require("../../../src/application/modules/ModuleManager");
const ModuleRegistry_1 = require("../../../src/application/modules/ModuleRegistry");
const ProductCatalogService_1 = require("../../../src/application/services/ProductCatalogService");
const UnitConversionService_1 = require("../../../src/application/services/UnitConversionService");
const BarcodeService_1 = require("../../../src/application/services/BarcodeService");
const CustomerService_1 = require("../../../src/application/services/CustomerService");
const SupplierService_1 = require("../../../src/application/services/SupplierService");
const StockLocationService_1 = require("../../../src/application/services/StockLocationService");
const StockAdjustmentService_1 = require("../../../src/application/services/StockAdjustmentService");
const StocktakeService_1 = require("../../../src/application/services/StocktakeService");
const StockTransferService_1 = require("../../../src/application/services/StockTransferService");
const connection_1 = require("../../../src/infrastructure/sqlite/connection");
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
    const onboardingService = new OnboardingService_1.OnboardingService();
    const approvalService = new ApprovalService_1.ApprovalService();
    const rbacService = new RbacService_1.RbacService();
    const customerRepo = new CustomerRepository_1.CustomerRepository();
    const supplierRepo = new SupplierRepository_1.SupplierRepository();
    const printerService = new thermal_printer_1.ThermalPrinterService();
    const moduleManager = new ModuleManager_1.ModuleManager((0, connection_1.getDatabase)(), ModuleRegistry_1.defaultModuleRegistry);
    const productCatalogService = new ProductCatalogService_1.ProductCatalogService((0, connection_1.getDatabase)());
    const unitConversionService = new UnitConversionService_1.UnitConversionService((0, connection_1.getDatabase)());
    const barcodeService = new BarcodeService_1.BarcodeService((0, connection_1.getDatabase)());
    const customerService = new CustomerService_1.CustomerService((0, connection_1.getDatabase)());
    const supplierService = new SupplierService_1.SupplierService((0, connection_1.getDatabase)());
    const stockLocationService = new StockLocationService_1.StockLocationService((0, connection_1.getDatabase)());
    const stockAdjustmentService = new StockAdjustmentService_1.StockAdjustmentService();
    const stocktakeService = new StocktakeService_1.StocktakeService((0, connection_1.getDatabase)());
    const stockTransferService = new StockTransferService_1.StockTransferService((0, connection_1.getDatabase)(), moduleManager);
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
        return authService.login({
            username: validated.username,
            passwordPlain: validated.password,
            deviceIdentifier: payload.deviceIdentifier
        });
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_VERIFY_SESSION, (sessionToken) => {
        return authService.verifySession(sessionToken);
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_LOGOUT, (sessionToken) => {
        authService.logout(sessionToken);
        return true;
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
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_CHANGE_PASSWORD, (payload) => {
        authService.changePassword(payload.userId, payload.currentPasswordPlain, payload.newPasswordPlain);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_ADMIN_RESET_PASSWORD, (payload) => {
        const adminContext = authService.verifySession(payload.sessionToken);
        authService.adminResetPassword(payload.targetUserId, payload.newPasswordPlain, adminContext);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_REVOKE_SESSION, (payload) => {
        const adminContext = authService.verifySession(payload.sessionToken);
        authService.revokeAllUserSessions(payload.sessionId, adminContext);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_REVOKE_ALL_SESSIONS, (payload) => {
        const adminContext = authService.verifySession(payload.sessionToken);
        authService.revokeAllUserSessions(payload.userId, adminContext);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.AUTH_GET_PERMISSIONS, (payload) => {
        return Array.from(rbacService.getUserPermissions(payload.userId, payload.businessId));
    });
    // --- Approvals Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.APPROVALS_REQUEST, (payload) => {
        const context = authService.verifySession(payload.sessionToken);
        return approvalService.createRequest(context, payload.request);
    });
    handle(ipc_channels_1.IPC_CHANNELS.APPROVALS_DECIDE, (payload) => {
        const context = authService.verifySession(payload.sessionToken);
        return approvalService.decideRequest(context, {
            requestId: payload.requestId,
            decision: payload.decision,
            reason: payload.reason
        });
    });
    handle(ipc_channels_1.IPC_CHANNELS.APPROVALS_LIST_PENDING, (payload) => {
        const context = authService.verifySession(payload.sessionToken);
        return approvalService.listPending(context, payload.branchId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.APPROVALS_GET_REQUEST, (requestId) => {
        return approvalService.getRequest(requestId);
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
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_LIST, (options) => {
        const businessId = options?.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.listCustomers(businessId, options);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (payload) => {
        const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.getCustomerById(businessId, payload.id);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SEARCH, (query) => {
        return customerService.listCustomers('00000000-0000-0000-0000-000000000001', { query });
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_SAVE, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return customerService.createCustomer(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_UPDATE, (payload) => {
        const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
        return customerService.updateCustomer(payload.id, payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_GET_LEDGER, (customerId) => {
        return customerRepo.getLedger(Number(customerId));
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return customerService.recordCustomerPayment(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_CHECK_CREDIT, (payload) => {
        const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.checkCreditExposure(businessId, payload.customerId, payload.newCreditMinor, payload.hasApproval);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_STATEMENT, (payload) => {
        const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.getCustomerStatement(businessId, payload.customerId, payload.fromDate, payload.toDate);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_OUTSTANDING_INVOICES, (payload) => {
        const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.getOutstandingInvoices(businessId, payload.customerId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_ALLOCATE_PAYMENT, (payload) => {
        const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
        return customerService.allocatePayment(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.CUSTOMERS_RECONCILE, (payload) => {
        const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return customerService.reconcileCustomerBalance(businessId, payload.customerId);
    });
    // --- Suppliers Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_LIST, (payload) => {
        return supplierService.listSuppliers(payload?.businessId, payload?.filter);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_BY_ID, (payload) => {
        return supplierService.getSupplierById(payload.id, payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SEARCH, (payload) => {
        const query = typeof payload === 'string' ? payload : payload.query;
        const bizId = typeof payload === 'object' ? payload.businessId : undefined;
        return supplierService.listSuppliers(bizId, { query });
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_SAVE, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return supplierService.createSupplier(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_UPDATE, (payload) => {
        const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
        return supplierService.updateSupplier(payload.id, payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_GET_LEDGER, (supplierId) => {
        return supplierRepo.getLedger(supplierId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return supplierService.recordSupplierPayment(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_REVERSE_PAYMENT, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner' };
        supplierService.reverseSupplierPayment(payload.paymentId, payload.reason, actor);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_STATEMENT, (payload) => {
        return supplierService.getSupplierStatement(payload.supplierId, payload.fromDate, payload.toDate, payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_OUTSTANDING_INVOICES, (payload) => {
        return supplierService.getOutstandingPurchaseInvoices(payload.supplierId, payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_RETURN, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return supplierService.recordSupplierReturn(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECORD_ADJUSTMENT, (payload) => {
        const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
        return supplierService.recordAdjustment(payload, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SUPPLIERS_RECONCILE, (payload) => {
        return supplierService.reconcileSupplierBalance(payload.supplierId);
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
    // --- Onboarding Handlers ---
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_STATUS, () => {
        return onboardingService.getStatus();
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_SAVE_DRAFT, (draft) => {
        onboardingService.saveDraft(draft);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_DRAFT, () => {
        return onboardingService.getDraft();
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_CLEAR_DRAFT, () => {
        onboardingService.clearDraft();
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_GET_MODULE_DEFINITIONS, (businessId) => {
        return onboardingService.getModuleDefinitions(businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_COMPLETE, (payload) => {
        return onboardingService.completeOnboarding(payload);
    });
    handle(ipc_channels_1.IPC_CHANNELS.ONBOARDING_UPDATE_MODULE, (params) => {
        onboardingService.updateModuleStatus(params.businessId, params.moduleCode, params.isEnabled);
        return true;
    });
    // --- Module Management & Framework ---
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_GET_NAVIGATION, (params) => {
        return moduleManager.getNavigation(params.businessId, params.userPermissions || []);
    });
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_LIST, () => {
        return ModuleRegistry_1.defaultModuleRegistry.getAllModules();
    });
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_STATUS_LIST, (params) => {
        return moduleManager.getModuleStatusList(params.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_ENABLE, (params) => {
        moduleManager.enableModule(params.businessId, params.moduleCode, params.userId);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_DISABLE, (params) => {
        moduleManager.disableModule(params.businessId, params.moduleCode, params.userId);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.MODULES_EVENTS, (params) => {
        return moduleManager.getModuleEvents(params.businessId, params.moduleCode);
    });
    // --- Product Catalogue Handlers (Prompt 6) ---
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE, (payload) => {
        return productCatalogService.createProduct(payload.dto, payload.userId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_UPDATE, (payload) => {
        return productCatalogService.updateProduct(payload.id, payload.dto, payload.userId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_ARCHIVE, (payload) => {
        productCatalogService.archiveProduct(payload.businessId, payload.id);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_DELETE, (payload) => {
        productCatalogService.deleteProduct(payload.businessId, payload.id);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_DUPLICATE, (payload) => {
        return productCatalogService.duplicateProduct(payload.businessId, payload.id, payload.newSku, payload.newName);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_SEARCH, (params) => {
        return productCatalogService.searchProducts(params);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_GET_BY_ID, (payload) => {
        return productCatalogService.getProductById(payload.businessId, payload.id);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_LIST_CATEGORIES, (payload) => {
        return productCatalogService.listCategories(payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE_CATEGORY, (dto) => {
        return productCatalogService.createCategory(dto);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_UPDATE_CATEGORY, (payload) => {
        return productCatalogService.updateCategory(payload.id, payload.businessId, payload.dto);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_LIST_BRANDS, (payload) => {
        return productCatalogService.listBrands(payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_CREATE_BRAND, (dto) => {
        return productCatalogService.createBrand(dto);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_SET_PRICE, (dto) => {
        return productCatalogService.createProductPrice(dto);
    });
    handle(ipc_channels_1.IPC_CHANNELS.PRODUCTS_GET_PRICES, (payload) => {
        return productCatalogService.getProductPrices(payload.businessId, payload.productId);
    });
    // Units & Conversions (Prompt 7)
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_LIST, (payload) => {
        return unitConversionService.listUnits(payload?.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_CREATE, (payload) => {
        return unitConversionService.createUnit(payload.dto, payload.actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_GET_CONVERSIONS, (payload) => {
        return unitConversionService.getProductConversions(payload.productId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_SAVE_CONVERSION, (payload) => {
        return unitConversionService.saveProductUnitConversion(payload.dto, payload.actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_TO_BASE, (payload) => {
        return unitConversionService.convertToBaseQuantity(payload.productId, payload.enteredQuantity, payload.enteredUnitId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_FROM_BASE, (payload) => {
        return unitConversionService.convertFromBaseQuantity(payload.productId, payload.baseQuantity, payload.targetUnitId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_CONVERT_PRICE, (payload) => {
        return unitConversionService.convertUnitPrice(payload.productId, payload.fromUnitId, payload.toUnitId, payload.priceMinor, payload.roundingMode);
    });
    handle(ipc_channels_1.IPC_CHANNELS.UNITS_CALCULATE_RETURN, (payload) => {
        return unitConversionService.calculateSaleReturn(payload);
    });
    // Barcodes & Scale Profiles (Prompt 8)
    handle(ipc_channels_1.IPC_CHANNELS.BARCODES_LOOKUP, (payload) => {
        return barcodeService.lookupBarcode(payload.businessId, payload.barcode);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BARCODES_ADD, (payload) => {
        return barcodeService.addBarcode(payload.dto, payload.actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BARCODES_SET_PRIMARY, (payload) => {
        return barcodeService.setPrimaryBarcode(payload.businessId, payload.productId, payload.barcodeId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BARCODES_DEACTIVATE, (payload) => {
        return barcodeService.deactivateBarcode(payload.businessId, payload.barcodeId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.BARCODES_LIST_PRODUCT, (payload) => {
        return barcodeService.listProductBarcodes(payload.productId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_LIST, (payload) => {
        return barcodeService.listScaleProfiles(payload.businessId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_CREATE, (payload) => {
        return barcodeService.createScaleProfile(payload.dto, payload.actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.SCALE_PROFILES_TEST, (payload) => {
        return barcodeService.testScaleBarcodeDiagnostic(payload.barcode, payload.profileIdOrProfile);
    });
    // --- Stock Locations Handlers (Prompt 11) ---
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_LIST, (payload) => {
        const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
        return stockLocationService.getLocations(bizId, payload?.branchId, payload?.includeInactive);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_BY_ID, (payload) => {
        const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return stockLocationService.getLocationById(payload.id, bizId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_CREATE, (payload) => {
        const bizId = payload.dto.businessId || '00000000-0000-0000-0000-000000000001';
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
        return stockLocationService.createLocation({ ...payload.dto, businessId: bizId }, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_UPDATE, (payload) => {
        const bizId = payload.dto?.businessId || '00000000-0000-0000-0000-000000000001';
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
        return stockLocationService.updateLocation(payload.id, payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_ARCHIVE, (payload) => {
        const bizId = payload.actor?.businessId || '00000000-0000-0000-0000-000000000001';
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
        stockLocationService.archiveLocation(payload.id, actor);
        return true;
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_STOCK, (payload) => {
        const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return stockLocationService.getLocationStock(payload.locationId, bizId, payload.filter);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_GET_PRODUCT_STOCK, (payload) => {
        const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return stockLocationService.getProductStockByLocations(payload.productId, bizId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_TRANSFER, (payload) => {
        const bizId = payload.dto.businessId || '00000000-0000-0000-0000-000000000001';
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
        return stockLocationService.transferStock({ ...payload.dto, businessId: bizId }, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_LOCATIONS_MOVEMENTS, (payload) => {
        const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
        return stockLocationService.getLocationMovements(payload.locationId, bizId, payload.limit);
    });
    // Stock Adjustments (Prompt 13)
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_LIST, (payload) => {
        return stockAdjustmentService.listAdjustments(payload || {});
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_BY_ID, (payload) => {
        return stockAdjustmentService.getAdjustmentById(payload.id);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_CREATE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.createAdjustment(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_SUBMIT, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.submitForApproval(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_APPROVE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.approveAdjustment(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_REJECT, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.rejectAdjustment(payload.id, payload.reason, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_CANCEL, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.cancelAdjustment(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_POST, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.postAdjustment(payload.id, actor, payload.options);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_REVERSE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.reverseAdjustment(payload.id, payload.reason, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_RELOCATE_DAMAGED, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.relocateToDamaged(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_WRITE_OFF, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.writeOffDamaged(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_RETURN_SELLABLE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.returnToSellable(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_POLICY, (payload) => {
        const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
        return stockAdjustmentService.getApprovalPolicy(bizId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_ADJUSTMENTS_UPDATE_POLICY, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockAdjustmentService.updateApprovalPolicy(payload.input, actor);
    });
    // Physical Stocktakes (Prompt 14)
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_LIST, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.listStocktakes(payload.filter, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_GET_BY_ID, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.getStocktakeById(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_CREATE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.createStocktake(payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_START, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.startStocktake(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_RECORD_COUNT, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'counter', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.recordCount(payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_RESOLVE_LINE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'supervisor', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.resolveDiscrepancy(payload.dto, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_SUBMIT_COUNTS, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'counter', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.submitCounts(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_REVIEW, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'supervisor', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.reviewStocktake(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_APPROVE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.approveStocktake(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_POST, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.postStocktake(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_CANCEL, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.cancelStocktake(payload.id, payload.reason, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_GET_REPORT, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        return stocktakeService.getStocktakeReport(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_GET_POLICY, (payload) => {
        const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
        return stocktakeService.getPolicy(bizId);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_UPDATE_POLICY, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
        const bizId = actor.businessId || '00000000-0000-0000-0000-000000000001';
        return stocktakeService.updatePolicy(bizId, payload.policy, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCKTAKES_CHECK_FREEZE, (payload) => {
        return stocktakeService.checkLocationFreeze(payload.stockLocationId);
    });
    // Stock Transfers & In-Transit Workflow (Prompt 15)
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_LIST, (payload) => {
        const filter = payload?.filter || { businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.listTransfers(filter);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_GET_BY_ID, (payload) => {
        return stockTransferService.getTransferById(payload.id);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_CREATE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.createTransfer(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_APPROVE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.approveTransfer(payload.id, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_DISPATCH, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.dispatchTransfer(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_RECEIVE, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.receiveTransfer(payload.input, actor);
    });
    handle(ipc_channels_1.IPC_CHANNELS.STOCK_TRANSFERS_CANCEL, (payload) => {
        const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
        return stockTransferService.cancelTransfer(payload.id, payload.reason, actor);
    });
}
