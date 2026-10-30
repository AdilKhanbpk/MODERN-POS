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
import { OnboardingService } from '../../../src/application/services/OnboardingService';
import { ApprovalService } from '../../../src/application/services/ApprovalService';
import { RbacService } from '../../../src/application/authorization/RbacService';
import { ModuleManager } from '../../../src/application/modules/ModuleManager';
import { defaultModuleRegistry } from '../../../src/application/modules/ModuleRegistry';
import { ProductCatalogService } from '../../../src/application/services/ProductCatalogService';
import { UnitConversionService } from '../../../src/application/services/UnitConversionService';
import { BarcodeService } from '../../../src/application/services/BarcodeService';
import { CustomerService } from '../../../src/application/services/CustomerService';
import { SupplierService } from '../../../src/application/services/SupplierService';
import { StockLocationService } from '../../../src/application/services/StockLocationService';
import { StockAdjustmentService } from '../../../src/application/services/StockAdjustmentService';
import { StocktakeService } from '../../../src/application/services/StocktakeService';
import { StockTransferService } from '../../../src/application/services/StockTransferService';
import { InventoryValuationService } from '../../../src/application/services/InventoryValuationService';
import { StockReservationService } from '../../../src/application/services/StockReservationService';
import { StockReplenishmentService } from '../../../src/application/services/StockReplenishmentService';
import { BatchExpiryService } from '../../../src/application/services/BatchExpiryService';
import { SerialTrackingService } from '../../../src/application/services/SerialTrackingService';
import { PurchaseOrderService } from '../../../src/application/services/PurchaseOrderService';
import { getDatabase } from '../../../src/infrastructure/sqlite/connection';
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
  const onboardingService = new OnboardingService();
  const approvalService = new ApprovalService();
  const rbacService = new RbacService();
  const customerRepo = new CustomerRepository();
  const supplierRepo = new SupplierRepository();
  const printerService = new ThermalPrinterService();
  const moduleManager = new ModuleManager(getDatabase(), defaultModuleRegistry);
  const productCatalogService = new ProductCatalogService(getDatabase());
  const unitConversionService = new UnitConversionService(getDatabase());
  const barcodeService = new BarcodeService(getDatabase());
  const customerService = new CustomerService(getDatabase());
  const supplierService = new SupplierService(getDatabase());
  const stockLocationService = new StockLocationService(getDatabase());
  const stockAdjustmentService = new StockAdjustmentService();
  const stocktakeService = new StocktakeService(getDatabase());
  const stockTransferService = new StockTransferService(getDatabase(), moduleManager);
  const valuationService = new InventoryValuationService(getDatabase());
  const stockReservationService = new StockReservationService(getDatabase());
  const stockReplenishmentService = new StockReplenishmentService(getDatabase());
  const batchExpiryService = new BatchExpiryService(getDatabase());
  const serialTrackingService = new SerialTrackingService(getDatabase());
  const purchaseOrderService = new PurchaseOrderService(getDatabase());

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
    return authService.login({
      username: validated.username,
      passwordPlain: validated.password,
      deviceIdentifier: payload.deviceIdentifier
    });
  });

  handle(IPC_CHANNELS.AUTH_VERIFY_SESSION, (sessionToken: string) => {
    return authService.verifySession(sessionToken);
  });

  handle(IPC_CHANNELS.AUTH_LOGOUT, (sessionToken?: string) => {
    authService.logout(sessionToken);
    return true;
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

  handle(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, (payload: { userId: string; currentPasswordPlain: string; newPasswordPlain: string }) => {
    authService.changePassword(payload.userId, payload.currentPasswordPlain, payload.newPasswordPlain);
    return true;
  });

  handle(IPC_CHANNELS.AUTH_ADMIN_RESET_PASSWORD, (payload: { targetUserId: string; newPasswordPlain: string; sessionToken: string }) => {
    const adminContext = authService.verifySession(payload.sessionToken);
    authService.adminResetPassword(payload.targetUserId, payload.newPasswordPlain, adminContext);
    return true;
  });

  handle(IPC_CHANNELS.AUTH_REVOKE_SESSION, (payload: { sessionId: string; sessionToken: string }) => {
    const adminContext = authService.verifySession(payload.sessionToken);
    authService.revokeAllUserSessions(payload.sessionId, adminContext);
    return true;
  });

  handle(IPC_CHANNELS.AUTH_REVOKE_ALL_SESSIONS, (payload: { userId: string; sessionToken: string }) => {
    const adminContext = authService.verifySession(payload.sessionToken);
    authService.revokeAllUserSessions(payload.userId, adminContext);
    return true;
  });

  handle(IPC_CHANNELS.AUTH_GET_PERMISSIONS, (payload: { userId: string; businessId: string }) => {
    return Array.from(rbacService.getUserPermissions(payload.userId, payload.businessId));
  });

  // --- Approvals Handlers ---
  handle(IPC_CHANNELS.APPROVALS_REQUEST, (payload: { sessionToken: string; request: any }) => {
    const context = authService.verifySession(payload.sessionToken);
    return approvalService.createRequest(context, payload.request);
  });

  handle(IPC_CHANNELS.APPROVALS_DECIDE, (payload: { sessionToken: string; requestId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) => {
    const context = authService.verifySession(payload.sessionToken);
    return approvalService.decideRequest(context, {
      requestId: payload.requestId,
      decision: payload.decision,
      reason: payload.reason
    });
  });

  handle(IPC_CHANNELS.APPROVALS_LIST_PENDING, (payload: { sessionToken: string; branchId?: string }) => {
    const context = authService.verifySession(payload.sessionToken);
    return approvalService.listPending(context, payload.branchId);
  });

  handle(IPC_CHANNELS.APPROVALS_GET_REQUEST, (requestId: string) => {
    return approvalService.getRequest(requestId);
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
  handle(IPC_CHANNELS.CUSTOMERS_LIST, (options?: any) => {
    const businessId = options?.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.listCustomers(businessId, options);
  });

  handle(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (payload: { id: string | number; businessId?: string }) => {
    const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.getCustomerById(businessId, payload.id);
  });

  handle(IPC_CHANNELS.CUSTOMERS_SEARCH, (query: string) => {
    return customerService.listCustomers('00000000-0000-0000-0000-000000000001', { query });
  });

  handle(IPC_CHANNELS.CUSTOMERS_SAVE, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return customerService.createCustomer(payload, actor);
  });

  handle(IPC_CHANNELS.CUSTOMERS_UPDATE, (payload: { id: string | number; dto: any; businessId?: string }) => {
    const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
    return customerService.updateCustomer(payload.id, payload.dto, actor);
  });

  handle(IPC_CHANNELS.CUSTOMERS_GET_LEDGER, (customerId: string | number) => {
    return customerRepo.getLedger(Number(customerId));
  });

  handle(IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return customerService.recordCustomerPayment(payload, actor);
  });

  handle(IPC_CHANNELS.CUSTOMERS_CHECK_CREDIT, (payload: {
    customerId: string | number;
    newCreditMinor: number;
    businessId?: string;
    hasApproval?: boolean;
  }) => {
    const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.checkCreditExposure(
      businessId,
      payload.customerId,
      payload.newCreditMinor,
      payload.hasApproval
    );
  });

  handle(IPC_CHANNELS.CUSTOMERS_STATEMENT, (payload: {
    customerId: string | number;
    businessId?: string;
    fromDate?: string;
    toDate?: string;
  }) => {
    const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.getCustomerStatement(
      businessId,
      payload.customerId,
      payload.fromDate,
      payload.toDate
    );
  });

  handle(IPC_CHANNELS.CUSTOMERS_OUTSTANDING_INVOICES, (payload: {
    customerId: string | number;
    businessId?: string;
  }) => {
    const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.getOutstandingInvoices(businessId, payload.customerId);
  });

  handle(IPC_CHANNELS.CUSTOMERS_ALLOCATE_PAYMENT, (payload: any) => {
    const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
    return customerService.allocatePayment(payload, actor);
  });

  handle(IPC_CHANNELS.CUSTOMERS_RECONCILE, (payload: {
    customerId: string | number;
    businessId?: string;
  }) => {
    const businessId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return customerService.reconcileCustomerBalance(businessId, payload.customerId);
  });

  // --- Suppliers Handlers ---
  handle(IPC_CHANNELS.SUPPLIERS_LIST, (payload?: { businessId?: string; filter?: any }) => {
    return supplierService.listSuppliers(payload?.businessId, payload?.filter);
  });

  handle(IPC_CHANNELS.SUPPLIERS_GET_BY_ID, (payload: { id: string | number; businessId?: string }) => {
    return supplierService.getSupplierById(payload.id, payload.businessId);
  });

  handle(IPC_CHANNELS.SUPPLIERS_SEARCH, (payload: string | { query: string; businessId?: string }) => {
    const query = typeof payload === 'string' ? payload : payload.query;
    const bizId = typeof payload === 'object' ? payload.businessId : undefined;
    return supplierService.listSuppliers(bizId, { query });
  });

  handle(IPC_CHANNELS.SUPPLIERS_SAVE, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return supplierService.createSupplier(payload, actor);
  });

  handle(IPC_CHANNELS.SUPPLIERS_UPDATE, (payload: { id: string | number; dto: any; businessId?: string }) => {
    const actor = { userId: 1, role: 'owner', businessId: payload.businessId };
    return supplierService.updateSupplier(payload.id, payload.dto, actor);
  });

  handle(IPC_CHANNELS.SUPPLIERS_GET_LEDGER, (supplierId: string | number) => {
    return supplierRepo.getLedger(supplierId);
  });

  handle(IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return supplierService.recordSupplierPayment(payload, actor);
  });

  handle(IPC_CHANNELS.SUPPLIERS_REVERSE_PAYMENT, (payload: { paymentId: string; reason: string; userId?: string | number }) => {
    const actor = { userId: payload.userId || 1, role: 'owner' };
    supplierService.reverseSupplierPayment(payload.paymentId, payload.reason, actor);
    return true;
  });

  handle(IPC_CHANNELS.SUPPLIERS_STATEMENT, (payload: {
    supplierId: string | number;
    businessId?: string;
    fromDate?: string;
    toDate?: string;
  }) => {
    return supplierService.getSupplierStatement(
      payload.supplierId,
      payload.fromDate,
      payload.toDate,
      payload.businessId
    );
  });

  handle(IPC_CHANNELS.SUPPLIERS_OUTSTANDING_INVOICES, (payload: {
    supplierId: string | number;
    businessId?: string;
  }) => {
    return supplierService.getOutstandingPurchaseInvoices(payload.supplierId, payload.businessId);
  });

  handle(IPC_CHANNELS.SUPPLIERS_RECORD_RETURN, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return supplierService.recordSupplierReturn(payload, actor);
  });

  handle(IPC_CHANNELS.SUPPLIERS_RECORD_ADJUSTMENT, (payload: any) => {
    const actor = { userId: payload.userId || 1, role: 'owner', businessId: payload.businessId };
    return supplierService.recordAdjustment(payload, actor);
  });

  handle(IPC_CHANNELS.SUPPLIERS_RECONCILE, (payload: { supplierId: string | number }) => {
    return supplierService.reconcileSupplierBalance(payload.supplierId);
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

  // --- Onboarding Handlers ---
  handle(IPC_CHANNELS.ONBOARDING_GET_STATUS, () => {
    return onboardingService.getStatus();
  });

  handle(IPC_CHANNELS.ONBOARDING_SAVE_DRAFT, (draft: any) => {
    onboardingService.saveDraft(draft);
    return true;
  });

  handle(IPC_CHANNELS.ONBOARDING_GET_DRAFT, () => {
    return onboardingService.getDraft();
  });

  handle(IPC_CHANNELS.ONBOARDING_CLEAR_DRAFT, () => {
    onboardingService.clearDraft();
    return true;
  });

  handle(IPC_CHANNELS.ONBOARDING_GET_MODULE_DEFINITIONS, (businessId?: string) => {
    return onboardingService.getModuleDefinitions(businessId);
  });

  handle(IPC_CHANNELS.ONBOARDING_COMPLETE, (payload: any) => {
    return onboardingService.completeOnboarding(payload);
  });

  handle(IPC_CHANNELS.ONBOARDING_UPDATE_MODULE, (params: { businessId: string; moduleCode: string; isEnabled: boolean }) => {
    onboardingService.updateModuleStatus(params.businessId, params.moduleCode, params.isEnabled);
    return true;
  });

  // --- Module Management & Framework ---
  handle(IPC_CHANNELS.MODULES_GET_NAVIGATION, (params: { businessId: string; userPermissions?: string[] }) => {
    return moduleManager.getNavigation(params.businessId, params.userPermissions || []);
  });

  handle(IPC_CHANNELS.MODULES_LIST, () => {
    return defaultModuleRegistry.getAllModules();
  });

  handle(IPC_CHANNELS.MODULES_STATUS_LIST, (params: { businessId: string }) => {
    return moduleManager.getModuleStatusList(params.businessId);
  });

  handle(IPC_CHANNELS.MODULES_ENABLE, (params: { businessId: string; moduleCode: string; userId?: string }) => {
    moduleManager.enableModule(params.businessId, params.moduleCode, params.userId);
    return true;
  });

  handle(IPC_CHANNELS.MODULES_DISABLE, (params: { businessId: string; moduleCode: string; userId?: string }) => {
    moduleManager.disableModule(params.businessId, params.moduleCode, params.userId);
    return true;
  });

  handle(IPC_CHANNELS.MODULES_EVENTS, (params: { businessId: string; moduleCode?: string }) => {
    return moduleManager.getModuleEvents(params.businessId, params.moduleCode);
  });

  // --- Product Catalogue Handlers (Prompt 6) ---
  handle(IPC_CHANNELS.PRODUCTS_CREATE, (payload: { dto: any; userId?: string }) => {
    return productCatalogService.createProduct(payload.dto, payload.userId);
  });

  handle(IPC_CHANNELS.PRODUCTS_UPDATE, (payload: { id: string; dto: any; userId?: string }) => {
    return productCatalogService.updateProduct(payload.id, payload.dto, payload.userId);
  });

  handle(IPC_CHANNELS.PRODUCTS_ARCHIVE, (payload: { businessId: string; id: string }) => {
    productCatalogService.archiveProduct(payload.businessId, payload.id);
    return true;
  });

  handle(IPC_CHANNELS.PRODUCTS_DELETE, (payload: { businessId: string; id: string }) => {
    productCatalogService.deleteProduct(payload.businessId, payload.id);
    return true;
  });

  handle(IPC_CHANNELS.PRODUCTS_DUPLICATE, (payload: { businessId: string; id: string; newSku: string; newName?: string }) => {
    return productCatalogService.duplicateProduct(payload.businessId, payload.id, payload.newSku, payload.newName);
  });

  handle(IPC_CHANNELS.PRODUCTS_SEARCH, (params: any) => {
    return productCatalogService.searchProducts(params);
  });

  handle(IPC_CHANNELS.PRODUCTS_GET_BY_ID, (payload: { businessId: string; id: string }) => {
    return productCatalogService.getProductById(payload.businessId, payload.id);
  });

  handle(IPC_CHANNELS.PRODUCTS_LIST_CATEGORIES, (payload: { businessId: string }) => {
    return productCatalogService.listCategories(payload.businessId);
  });

  handle(IPC_CHANNELS.PRODUCTS_CREATE_CATEGORY, (dto: any) => {
    return productCatalogService.createCategory(dto);
  });

  handle(IPC_CHANNELS.PRODUCTS_UPDATE_CATEGORY, (payload: { id: string; businessId: string; dto: any }) => {
    return productCatalogService.updateCategory(payload.id, payload.businessId, payload.dto);
  });

  handle(IPC_CHANNELS.PRODUCTS_LIST_BRANDS, (payload: { businessId: string }) => {
    return productCatalogService.listBrands(payload.businessId);
  });

  handle(IPC_CHANNELS.PRODUCTS_CREATE_BRAND, (dto: any) => {
    return productCatalogService.createBrand(dto);
  });

  handle(IPC_CHANNELS.PRODUCTS_SET_PRICE, (dto: any) => {
    return productCatalogService.createProductPrice(dto);
  });

  handle(IPC_CHANNELS.PRODUCTS_GET_PRICES, (payload: { businessId: string; productId: string }) => {
    return productCatalogService.getProductPrices(payload.businessId, payload.productId);
  });

  // Units & Conversions (Prompt 7)
  handle(IPC_CHANNELS.UNITS_LIST, (payload?: { businessId?: string }) => {
    return unitConversionService.listUnits(payload?.businessId);
  });

  handle(IPC_CHANNELS.UNITS_CREATE, (payload: { dto: any; actor: any }) => {
    return unitConversionService.createUnit(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.UNITS_GET_CONVERSIONS, (payload: { productId: string | number }) => {
    return unitConversionService.getProductConversions(payload.productId);
  });

  handle(IPC_CHANNELS.UNITS_SAVE_CONVERSION, (payload: { dto: any; actor: any }) => {
    return unitConversionService.saveProductUnitConversion(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.UNITS_CONVERT_TO_BASE, (payload: { productId: string | number; enteredQuantity: number; enteredUnitId: string | number }) => {
    return unitConversionService.convertToBaseQuantity(payload.productId, payload.enteredQuantity, payload.enteredUnitId);
  });

  handle(IPC_CHANNELS.UNITS_CONVERT_FROM_BASE, (payload: { productId: string | number; baseQuantity: number; targetUnitId: string | number }) => {
    return unitConversionService.convertFromBaseQuantity(payload.productId, payload.baseQuantity, payload.targetUnitId);
  });

  handle(IPC_CHANNELS.UNITS_CONVERT_PRICE, (payload: { productId: string | number; fromUnitId: string | number; toUnitId: string | number; priceMinor: number; roundingMode?: any }) => {
    return unitConversionService.convertUnitPrice(payload.productId, payload.fromUnitId, payload.toUnitId, payload.priceMinor, payload.roundingMode);
  });

  handle(IPC_CHANNELS.UNITS_CALCULATE_RETURN, (payload: any) => {
    return unitConversionService.calculateSaleReturn(payload);
  });

  // Barcodes & Scale Profiles (Prompt 8)
  handle(IPC_CHANNELS.BARCODES_LOOKUP, (payload: { businessId: string; barcode: string }) => {
    return barcodeService.lookupBarcode(payload.businessId, payload.barcode);
  });

  handle(IPC_CHANNELS.BARCODES_ADD, (payload: { dto: any; actor: any }) => {
    return barcodeService.addBarcode(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.BARCODES_SET_PRIMARY, (payload: { businessId: string; productId: string | number; barcodeId: string }) => {
    return barcodeService.setPrimaryBarcode(payload.businessId, payload.productId, payload.barcodeId);
  });

  handle(IPC_CHANNELS.BARCODES_DEACTIVATE, (payload: { businessId: string; barcodeId: string }) => {
    return barcodeService.deactivateBarcode(payload.businessId, payload.barcodeId);
  });

  handle(IPC_CHANNELS.BARCODES_LIST_PRODUCT, (payload: { productId: string | number }) => {
    return barcodeService.listProductBarcodes(payload.productId);
  });

  handle(IPC_CHANNELS.SCALE_PROFILES_LIST, (payload: { businessId: string }) => {
    return barcodeService.listScaleProfiles(payload.businessId);
  });

  handle(IPC_CHANNELS.SCALE_PROFILES_CREATE, (payload: { dto: any; actor: any }) => {
    return barcodeService.createScaleProfile(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.SCALE_PROFILES_TEST, (payload: { barcode: string; profileIdOrProfile: any }) => {
    return barcodeService.testScaleBarcodeDiagnostic(payload.barcode, payload.profileIdOrProfile);
  });

  // --- Stock Locations Handlers (Prompt 11) ---
  handle(IPC_CHANNELS.STOCK_LOCATIONS_LIST, (payload?: { businessId?: string; branchId?: string; includeInactive?: boolean }) => {
    const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
    return stockLocationService.getLocations(bizId, payload?.branchId, payload?.includeInactive);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_GET_BY_ID, (payload: { id: string; businessId?: string }) => {
    const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return stockLocationService.getLocationById(payload.id, bizId);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_CREATE, (payload: { dto: any; actor?: any }) => {
    const bizId = payload.dto.businessId || '00000000-0000-0000-0000-000000000001';
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
    return stockLocationService.createLocation({ ...payload.dto, businessId: bizId }, actor);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_UPDATE, (payload: { id: string; dto: any; actor?: any }) => {
    const bizId = payload.dto?.businessId || '00000000-0000-0000-0000-000000000001';
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
    return stockLocationService.updateLocation(payload.id, payload.dto, actor);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_ARCHIVE, (payload: { id: string; actor?: any }) => {
    const bizId = payload.actor?.businessId || '00000000-0000-0000-0000-000000000001';
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
    stockLocationService.archiveLocation(payload.id, actor);
    return true;
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_GET_STOCK, (payload: { locationId: string; businessId?: string; filter?: any }) => {
    const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return stockLocationService.getLocationStock(payload.locationId, bizId, payload.filter);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_GET_PRODUCT_STOCK, (payload: { productId: string | number; businessId?: string }) => {
    const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return stockLocationService.getProductStockByLocations(payload.productId, bizId);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_TRANSFER, (payload: { dto: any; actor?: any }) => {
    const bizId = payload.dto.businessId || '00000000-0000-0000-0000-000000000001';
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: bizId };
    return stockLocationService.transferStock({ ...payload.dto, businessId: bizId }, actor);
  });

  handle(IPC_CHANNELS.STOCK_LOCATIONS_MOVEMENTS, (payload: { locationId: string; businessId?: string; limit?: number }) => {
    const bizId = payload.businessId || '00000000-0000-0000-0000-000000000001';
    return stockLocationService.getLocationMovements(payload.locationId, bizId, payload.limit);
  });

  // Stock Adjustments (Prompt 13)
  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_LIST, (payload: any) => {
    return stockAdjustmentService.listAdjustments(payload || {});
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_BY_ID, (payload: { id: string }) => {
    return stockAdjustmentService.getAdjustmentById(payload.id);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_CREATE, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.createAdjustment(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_SUBMIT, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.submitForApproval(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_APPROVE, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.approveAdjustment(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_REJECT, (payload: { id: string; reason: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.rejectAdjustment(payload.id, payload.reason, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_CANCEL, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.cancelAdjustment(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_POST, (payload: { id: string; actor?: any; options?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.postAdjustment(payload.id, actor, payload.options);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_REVERSE, (payload: { id: string; reason: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.reverseAdjustment(payload.id, payload.reason, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_RELOCATE_DAMAGED, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.relocateToDamaged(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_WRITE_OFF, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.writeOffDamaged(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_RETURN_SELLABLE, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.returnToSellable(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_POLICY, (payload: { businessId?: string }) => {
    const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
    return stockAdjustmentService.getApprovalPolicy(bizId);
  });

  handle(IPC_CHANNELS.STOCK_ADJUSTMENTS_UPDATE_POLICY, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockAdjustmentService.updateApprovalPolicy(payload.input, actor);
  });

  // Physical Stocktakes (Prompt 14)
  handle(IPC_CHANNELS.STOCKTAKES_LIST, (payload: { filter: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.listStocktakes(payload.filter, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_GET_BY_ID, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.getStocktakeById(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_CREATE, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.createStocktake(payload.dto, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_START, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.startStocktake(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_RECORD_COUNT, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'counter', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.recordCount(payload.dto, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_RESOLVE_LINE, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'supervisor', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.resolveDiscrepancy(payload.dto, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_SUBMIT_COUNTS, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'counter', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.submitCounts(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_REVIEW, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'supervisor', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.reviewStocktake(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_APPROVE, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.approveStocktake(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_POST, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.postStocktake(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_CANCEL, (payload: { id: string; reason: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.cancelStocktake(payload.id, payload.reason, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_GET_REPORT, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    return stocktakeService.getStocktakeReport(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_GET_POLICY, (payload: { businessId?: string }) => {
    const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
    return stocktakeService.getPolicy(bizId);
  });

  handle(IPC_CHANNELS.STOCKTAKES_UPDATE_POLICY, (payload: { policy: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'owner', businessId: '00000000-0000-0000-0000-000000000001' };
    const bizId = actor.businessId || '00000000-0000-0000-0000-000000000001';
    return stocktakeService.updatePolicy(bizId, payload.policy, actor);
  });

  handle(IPC_CHANNELS.STOCKTAKES_CHECK_FREEZE, (payload: { stockLocationId: string }) => {
    return stocktakeService.checkLocationFreeze(payload.stockLocationId);
  });

  // Stock Transfers & In-Transit Workflow (Prompt 15)
  handle(IPC_CHANNELS.STOCK_TRANSFERS_LIST, (payload: { filter: any }) => {
    const filter = payload?.filter || { businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.listTransfers(filter);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_GET_BY_ID, (payload: { id: string }) => {
    return stockTransferService.getTransferById(payload.id);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_CREATE, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.createTransfer(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_APPROVE, (payload: { id: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.approveTransfer(payload.id, actor);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_DISPATCH, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.dispatchTransfer(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_RECEIVE, (payload: { input: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.receiveTransfer(payload.input, actor);
  });

  handle(IPC_CHANNELS.STOCK_TRANSFERS_CANCEL, (payload: { id: string; reason: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: '00000000-0000-0000-0000-000000000001' };
    return stockTransferService.cancelTransfer(payload.id, payload.reason, actor);
  });

  // Inventory Valuation & Costing (Prompt 16)
  handle(IPC_CHANNELS.VALUATION_GET_REPORT, (payload: { businessId?: string; locationId?: string }) => {
    const bizId = payload?.businessId || '00000000-0000-0000-0000-000000000001';
    return valuationService.getValuationReport(bizId, payload?.locationId);
  });

  handle(IPC_CHANNELS.VALUATION_PROCESS_INBOUND, (payload: { input: any }) => {
    return valuationService.processInboundReceipt(payload.input);
  });

  handle(IPC_CHANNELS.VALUATION_PROCESS_OUTBOUND, (payload: { input: any }) => {
    return valuationService.processOutboundIssue(payload.input);
  });

  handle(IPC_CHANNELS.VALUATION_REVALUE, (payload: { params: any }) => {
    return valuationService.revalueInventory(payload.params);
  });

  handle(IPC_CHANNELS.VALUATION_ALLOCATE_LANDED_COSTS, (payload: { input: any }) => {
    return valuationService.allocateLandedCosts(payload.input);
  });

  handle(IPC_CHANNELS.VALUATION_CUSTOMER_RETURN, (payload: { input: any }) => {
    return valuationService.processCustomerReturn(payload.input);
  });

  // Stock Reservations (Prompt 17)
  handle(IPC_CHANNELS.RESERVATIONS_LIST, (filter: any) => {
    return stockReservationService.listReservations(filter);
  });

  handle(IPC_CHANNELS.RESERVATIONS_GET_BY_ID, (payload: { id: string }) => {
    return stockReservationService.getReservation(payload.id);
  });

  handle(IPC_CHANNELS.RESERVATIONS_CREATE, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager', businessId: payload.dto?.businessId };
    return stockReservationService.createReservation(payload.dto, actor);
  });

  handle(IPC_CHANNELS.RESERVATIONS_FULFILL, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager' };
    return stockReservationService.fulfillReservation(payload.dto, actor);
  });

  handle(IPC_CHANNELS.RESERVATIONS_RELEASE, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager' };
    return stockReservationService.releaseReservation(payload.dto, actor);
  });

  handle(IPC_CHANNELS.RESERVATIONS_EXTEND, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager' };
    return stockReservationService.extendReservation(payload.dto, actor);
  });

  handle(IPC_CHANNELS.RESERVATIONS_CANCEL, (payload: { id: string; reason?: string; actor?: any }) => {
    const actor = payload.actor || { userId: 1, role: 'manager' };
    return stockReservationService.cancelReservation(payload.id, actor, payload.reason);
  });

  handle(IPC_CHANNELS.RESERVATIONS_CHECK_EXPIRED, (payload: { businessId?: string }) => {
    return stockReservationService.checkAndExpireReservations(payload?.businessId);
  });

  // Stock Monitoring & Replenishment (Prompt 18)
  handle(IPC_CHANNELS.REPLENISHMENT_GET_RULES, (payload: { businessId: string; locationId?: string }) => {
    return stockReplenishmentService.listReorderRules(payload.businessId, payload.locationId);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_SET_RULE, (payload: { dto: any }) => {
    return stockReplenishmentService.setReorderRule(payload.dto);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_GENERATE_SUGGESTIONS, (filter: any) => {
    return stockReplenishmentService.generateReplenishmentSuggestions(filter);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_LIST_SUGGESTIONS, (filter: any) => {
    return stockReplenishmentService.listSuggestions(filter);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_EDIT_SUGGESTION, (payload: { id: string; quantityScaled: number }) => {
    return stockReplenishmentService.editSuggestionQuantity(payload.id, payload.quantityScaled);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_DISMISS_SUGGESTION, (payload: { id: string }) => {
    stockReplenishmentService.dismissSuggestion(payload.id);
    return true;
  });

  handle(IPC_CHANNELS.REPLENISHMENT_CONVERT_TO_PO, (payload: { dto: any; actor?: any }) => {
    const actor = payload.actor || { userId: 1 };
    return stockReplenishmentService.convertSuggestionsToDraftPo(payload.dto, actor);
  });

  handle(IPC_CHANNELS.REPLENISHMENT_GET_ALERTS, (payload: { businessId: string; locationId?: string }) => {
    return stockReplenishmentService.getStockAlerts(payload.businessId, payload.locationId);
  });

  // Batch & Expiry Management (Prompt 19)
  handle(IPC_CHANNELS.BATCH_GET_SETTINGS, (payload: { productId: string | number; businessId: string }) => {
    return batchExpiryService.getBatchSettings(payload.productId, payload.businessId);
  });

  handle(IPC_CHANNELS.BATCH_CONFIGURE_SETTINGS, (payload: { dto: any }) => {
    return batchExpiryService.configureBatchSettings(payload.dto);
  });

  handle(IPC_CHANNELS.BATCH_RECEIVE, (payload: { dto: any; actor?: any }) => {
    return batchExpiryService.receiveBatch(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.BATCH_LIST, (filter: any) => {
    return (batchExpiryService as any).repo.listBatches(filter);
  });

  handle(IPC_CHANNELS.BATCH_GET_BY_ID, (batchId: string) => {
    return (batchExpiryService as any).repo.findById(batchId);
  });

  handle(IPC_CHANNELS.BATCH_ALLOCATE_FEFO, (params: any) => {
    return batchExpiryService.allocateBatchesForSale(params);
  });

  handle(IPC_CHANNELS.BATCH_CUSTOMER_RETURN, (payload: { dto: any; actor?: any }) => {
    return batchExpiryService.customerReturnBatch(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.BATCH_RECALL, (payload: { dto: any; actor?: any }) => {
    return batchExpiryService.recallBatch(payload.dto, payload.actor);
  });

  handle(IPC_CHANNELS.BATCH_RELEASE_QUARANTINE, (payload: { batchId: string; actor?: any }) => {
    return batchExpiryService.releaseQuarantineBatch(payload.batchId, payload.actor);
  });

  handle(IPC_CHANNELS.BATCH_WRITE_OFF, (payload: { dto: any; actor?: any }) => {
    batchExpiryService.writeOffBatch(payload.dto, payload.actor);
    return true;
  });

  handle(IPC_CHANNELS.BATCH_TRANSFER, (payload: { params: any; actor?: any }) => {
    batchExpiryService.transferBatchStock(payload.params, payload.actor);
    return true;
  });

  handle(IPC_CHANNELS.BATCH_REPORT_STOCK, (payload: { businessId: string; locationId?: string }) => {
    return batchExpiryService.getBatchStockReport(payload.businessId, payload.locationId);
  });

  handle(IPC_CHANNELS.BATCH_REPORT_EXPIRING_SOON, (payload: { businessId: string; daysThreshold?: number; locationId?: string }) => {
    return batchExpiryService.getExpiringSoonReport(payload.businessId, payload.daysThreshold, payload.locationId);
  });

  handle(IPC_CHANNELS.BATCH_REPORT_EXPIRED, (payload: { businessId: string; locationId?: string }) => {
    return batchExpiryService.getExpiredStockReport(payload.businessId, payload.locationId);
  });

  handle(IPC_CHANNELS.BATCH_REPORT_RECALLED, (payload: { businessId: string }) => {
    return batchExpiryService.getRecalledBatchReport(payload.businessId);
  });

  handle(IPC_CHANNELS.BATCH_REPORT_VALUATION, (payload: { businessId: string; locationId?: string }) => {
    return batchExpiryService.getBatchValuationReport(payload.businessId, payload.locationId);
  });

  handle(IPC_CHANNELS.BATCH_TRACE_SALES, (batchId: string) => {
    return batchExpiryService.getBatchSalesTraceability(batchId);
  });

  // --- Serial Tracking Handlers (Prompt 20) ---
  handle(IPC_CHANNELS.SERIAL_GET_SETTINGS, (payload: { businessId: string; productId: string | number }) => {
    return serialTrackingService.getSettings(payload.businessId, payload.productId);
  });

  handle(IPC_CHANNELS.SERIAL_CONFIGURE_SETTINGS, (payload: any) => {
    return serialTrackingService.configureSettings(payload);
  });

  handle(IPC_CHANNELS.SERIAL_RECEIVE, (payload: any) => {
    return serialTrackingService.receiveSerialUnits(payload);
  });

  handle(IPC_CHANNELS.SERIAL_ALLOCATE_SALE, (payload: any) => {
    return serialTrackingService.validateAndAllocateSaleSerials(payload);
  });

  handle(IPC_CHANNELS.SERIAL_CUSTOMER_RETURN, (payload: any) => {
    return serialTrackingService.processCustomerReturn(payload);
  });

  handle(IPC_CHANNELS.SERIAL_TRANSFER, (payload: any) => {
    return serialTrackingService.transferSerial(payload);
  });

  handle(IPC_CHANNELS.SERIAL_WARRANTY_CLAIM, (payload: any) => {
    return serialTrackingService.createWarrantyClaim(payload);
  });

  handle(IPC_CHANNELS.SERIAL_REPLACE_DEFECTIVE, (payload: any) => {
    return serialTrackingService.replaceDefectiveSerial(payload);
  });

  handle(IPC_CHANNELS.SERIAL_UPDATE_STATUS, (payload: any) => {
    return serialTrackingService.updateSerialStatus(payload);
  });

  handle(IPC_CHANNELS.SERIAL_SEARCH, (payload: { query: any; permissions?: any[] }) => {
    return serialTrackingService.searchSerials(payload.query, payload.permissions || []);
  });

  handle(IPC_CHANNELS.SERIAL_GET_AUDIT, (payload: { businessId: string; serialIdentifier: string; permissions?: any[] }) => {
    return serialTrackingService.getSerialAudit(payload.businessId, payload.serialIdentifier, payload.permissions || []);
  });

  // --- Purchase Orders Handlers (Prompt 21) ---
  handle(IPC_CHANNELS.PO_GET_SETTINGS, (payload: { businessId: string }) => {
    return purchaseOrderService.getSettings(payload.businessId);
  });

  handle(IPC_CHANNELS.PO_CONFIGURE_SETTINGS, (payload: { businessId: string; settings: any }) => {
    return purchaseOrderService.configureSettings(payload.businessId, payload.settings);
  });

  handle(IPC_CHANNELS.PO_CREATE, (payload: { input: any; actor: any }) => {
    return purchaseOrderService.createOrder(payload.input, payload.actor);
  });

  handle(IPC_CHANNELS.PO_GET_BY_ID, (payload: { id: string; businessId?: string }) => {
    return purchaseOrderService.findById(payload.id, payload.businessId);
  });

  handle(IPC_CHANNELS.PO_SUBMIT_APPROVAL, (payload: { poId: string; actor: any }) => {
    return purchaseOrderService.submitForApproval(payload.poId, payload.actor);
  });

  handle(IPC_CHANNELS.PO_APPROVE, (payload: { poId: string; actor: any }) => {
    return purchaseOrderService.approveOrder(payload.poId, payload.actor);
  });

  handle(IPC_CHANNELS.PO_MARK_SENT, (payload: { poId: string; actor: any }) => {
    return purchaseOrderService.markAsSent(payload.poId, payload.actor);
  });

  handle(IPC_CHANNELS.PO_RECEIVE_GOODS, (payload: { input: any; actor: any }) => {
    return purchaseOrderService.receiveGoods(payload.input, payload.actor);
  });

  handle(IPC_CHANNELS.PO_RECORD_INVOICE, (payload: { input: any; actor: any }) => {
    return purchaseOrderService.recordPurchaseInvoice(payload.input, payload.actor);
  });

  handle(IPC_CHANNELS.PO_CANCEL, (payload: { poId: string; reason: string; actor: any }) => {
    return purchaseOrderService.cancelOrder(payload.poId, payload.reason, payload.actor);
  });

  handle(IPC_CHANNELS.PO_CLOSE, (payload: { poId: string; reason: string; actor: any }) => {
    return purchaseOrderService.closeOrder(payload.poId, payload.reason, payload.actor);
  });

  handle(IPC_CHANNELS.PO_SEARCH, (payload: { query: any }) => {
    return purchaseOrderService.search(payload.query);
  });

  handle(IPC_CHANNELS.PO_GET_OUTSTANDING_REPORT, (payload: { businessId: string; supplierId?: string }) => {
    return purchaseOrderService.getOutstandingDeliveryReport(payload.businessId, payload.supplierId);
  });

  handle(IPC_CHANNELS.PO_GET_LAST_PRICE, (payload: { businessId: string; supplierId: string | number; productId: string | number }) => {
    return purchaseOrderService.getLastPurchasePrice(payload.businessId, payload.supplierId, payload.productId);
  });
}

