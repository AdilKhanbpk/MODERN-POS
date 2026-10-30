import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ApiResponse } from '../../src/shared/contracts/ipc-channels';
import {
  User, Customer, Supplier, Product, Sale, SaleCalculationResult,
  CreateSaleRequest, CreatePurchaseOrderRequest, PurchaseOrder,
  Account, JournalEntry, JournalEntryLine, Expense, Employee,
  PayrollRun, SystemSettings, DailyZReport, CartItemInput, StockAdjustmentRequest,
  OnboardingPayload, OnboardingDraft, OnboardingStatus, ModuleDefinitionWithEnables,
  SecurityContext, LoginResult, ApprovalRequest
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
    login: (username: string, passwordPlain: string, deviceIdentifier?: string): Promise<LoginResult | User> =>
      invoke(IPC_CHANNELS.AUTH_LOGIN, { username, password: passwordPlain, deviceIdentifier }),
    verifySession: (sessionToken: string): Promise<SecurityContext> =>
      invoke(IPC_CHANNELS.AUTH_VERIFY_SESSION, sessionToken),
    logout: (sessionToken?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_LOGOUT, sessionToken),
    getCurrentUser: (): Promise<User | null> =>
      invoke(IPC_CHANNELS.AUTH_GET_CURRENT_USER),
    listUsers: (): Promise<User[]> =>
      invoke(IPC_CHANNELS.AUTH_LIST_USERS),
    createUser: (data: { username: string; passwordPlain: string; fullName: string; role: Role }): Promise<number> =>
      invoke(IPC_CHANNELS.AUTH_CREATE_USER, data),
    updatePassword: (userId: number, newPasswordPlain: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_UPDATE_PASSWORD, { userId, newPassword: newPasswordPlain }),
    changePassword: (userId: string, currentPasswordPlain: string, newPasswordPlain: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { userId, currentPasswordPlain, newPasswordPlain }),
    adminResetPassword: (targetUserId: string, newPasswordPlain: string, sessionToken: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_ADMIN_RESET_PASSWORD, { targetUserId, newPasswordPlain, sessionToken }),
    revokeSession: (sessionId: string, sessionToken: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_REVOKE_SESSION, { sessionId, sessionToken }),
    revokeAllUserSessions: (userId: string, sessionToken: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.AUTH_REVOKE_ALL_SESSIONS, { userId, sessionToken }),
    getUserPermissions: (userId: string, businessId: string): Promise<string[]> =>
      invoke(IPC_CHANNELS.AUTH_GET_PERMISSIONS, { userId, businessId })
  },

  // Approvals & Overrides
  approvals: {
    request: (sessionToken: string, request: any): Promise<ApprovalRequest> =>
      invoke(IPC_CHANNELS.APPROVALS_REQUEST, { sessionToken, request }),
    decide: (sessionToken: string, requestId: string, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<ApprovalRequest> =>
      invoke(IPC_CHANNELS.APPROVALS_DECIDE, { sessionToken, requestId, decision, reason }),
    listPending: (sessionToken: string, branchId?: string): Promise<ApprovalRequest[]> =>
      invoke(IPC_CHANNELS.APPROVALS_LIST_PENDING, { sessionToken, branchId }),
    getRequest: (requestId: string): Promise<ApprovalRequest | null> =>
      invoke(IPC_CHANNELS.APPROVALS_GET_REQUEST, requestId)
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
    list: (options?: any): Promise<any[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_LIST, options),
    getById: (id: string | number, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, { id, businessId }),
    search: (query: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_SEARCH, query),
    save: (customer: any): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_SAVE, customer),
    update: (id: string | number, dto: any, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_UPDATE, { id, dto, businessId }),
    getLedger: (customerId: number | string): Promise<any[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_GET_LEDGER, customerId),
    recordPayment: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_RECORD_PAYMENT, payload),
    checkCredit: (customerId: string | number, newCreditMinor: number, businessId?: string, hasApproval?: boolean): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_CHECK_CREDIT, { customerId, newCreditMinor, businessId, hasApproval }),
    getStatement: (customerId: string | number, businessId?: string, fromDate?: string, toDate?: string): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_STATEMENT, { customerId, businessId, fromDate, toDate }),
    getOutstandingInvoices: (customerId: string | number, businessId?: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.CUSTOMERS_OUTSTANDING_INVOICES, { customerId, businessId }),
    allocatePayment: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_ALLOCATE_PAYMENT, dto),
    reconcile: (customerId: string | number, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.CUSTOMERS_RECONCILE, { customerId, businessId })
  },

  // Suppliers
  suppliers: {
    list: (payload?: any): Promise<any[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_LIST, payload),
    getById: (id: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_GET_BY_ID, { id }),
    search: (query: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_SEARCH, query),
    save: (supplier: any): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_SAVE, supplier),
    update: (id: string | number, dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_UPDATE, { id, dto }),
    getLedger: (supplierId: string | number): Promise<any[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_GET_LEDGER, supplierId),
    recordPayment: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_RECORD_PAYMENT, payload),
    reversePayment: (payload: { paymentId: string; reason: string }): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_REVERSE_PAYMENT, payload),
    getStatement: (payload: { supplierId: string | number; fromDate?: string; toDate?: string }): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_STATEMENT, payload),
    getOutstandingInvoices: (supplierId: string | number): Promise<any[]> =>
      invoke(IPC_CHANNELS.SUPPLIERS_OUTSTANDING_INVOICES, { supplierId }),
    recordReturn: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_RECORD_RETURN, payload),
    recordAdjustment: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_RECORD_ADJUSTMENT, payload),
    reconcile: (supplierId: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.SUPPLIERS_RECONCILE, { supplierId })
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
  },

  // Onboarding & Setup
  onboarding: {
    getStatus: (): Promise<OnboardingStatus> =>
      invoke(IPC_CHANNELS.ONBOARDING_GET_STATUS),
    saveDraft: (draft: OnboardingDraft): Promise<boolean> =>
      invoke(IPC_CHANNELS.ONBOARDING_SAVE_DRAFT, draft),
    getDraft: (): Promise<OnboardingDraft | null> =>
      invoke(IPC_CHANNELS.ONBOARDING_GET_DRAFT),
    clearDraft: (): Promise<boolean> =>
      invoke(IPC_CHANNELS.ONBOARDING_CLEAR_DRAFT),
    getModuleDefinitions: (businessId?: string): Promise<ModuleDefinitionWithEnables[]> =>
      invoke(IPC_CHANNELS.ONBOARDING_GET_MODULE_DEFINITIONS, businessId),
    complete: (payload: OnboardingPayload): Promise<{ businessId: string; branchId: string; counterId: string; userId: string }> =>
      invoke(IPC_CHANNELS.ONBOARDING_COMPLETE, payload),
    updateModuleStatus: (params: { businessId: string; moduleCode: string; isEnabled: boolean }): Promise<boolean> =>
      invoke(IPC_CHANNELS.ONBOARDING_UPDATE_MODULE, params)
  },

  // Modules & Optional Framework
  modules: {
    getNavigation: (businessId: string, userPermissions: string[] = []): Promise<any[]> =>
      invoke(IPC_CHANNELS.MODULES_GET_NAVIGATION, { businessId, userPermissions }),
    listAll: (): Promise<any[]> =>
      invoke(IPC_CHANNELS.MODULES_LIST),
    getStatusList: (businessId: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.MODULES_STATUS_LIST, { businessId }),
    enable: (businessId: string, moduleCode: string, userId?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.MODULES_ENABLE, { businessId, moduleCode, userId }),
    disable: (businessId: string, moduleCode: string, userId?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.MODULES_DISABLE, { businessId, moduleCode, userId }),
    getEvents: (businessId: string, moduleCode?: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.MODULES_EVENTS, { businessId, moduleCode })
  },

  // Product Catalogue (Prompt 6)
  catalogue: {
    createProduct: (dto: any, userId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_CREATE, { dto, userId }),
    updateProduct: (id: string, dto: any, userId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_UPDATE, { id, dto, userId }),
    archiveProduct: (businessId: string, id: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.PRODUCTS_ARCHIVE, { businessId, id }),
    deleteProduct: (businessId: string, id: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.PRODUCTS_DELETE, { businessId, id }),
    duplicateProduct: (businessId: string, id: string, newSku: string, newName?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_DUPLICATE, { businessId, id, newSku, newName }),
    searchProducts: (params: any): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_SEARCH, params),
    getProductById: (businessId: string, id: string): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_GET_BY_ID, { businessId, id }),
    listCategories: (businessId: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.PRODUCTS_LIST_CATEGORIES, { businessId }),
    createCategory: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_CREATE_CATEGORY, dto),
    updateCategory: (id: string, businessId: string, dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_UPDATE_CATEGORY, { id, businessId, dto }),
    listBrands: (businessId: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.PRODUCTS_LIST_BRANDS, { businessId }),
    createBrand: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_CREATE_BRAND, dto),
    setPrice: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.PRODUCTS_SET_PRICE, dto),
    getPrices: (businessId: string, productId: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.PRODUCTS_GET_PRICES, { businessId, productId })
  },

  // Units & Unit Conversions (Prompt 7)
  units: {
    listUnits: (businessId?: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.UNITS_LIST, { businessId }),
    createUnit: (dto: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_CREATE, { dto, actor }),
    getConversions: (productId: string | number): Promise<any[]> =>
      invoke(IPC_CHANNELS.UNITS_GET_CONVERSIONS, { productId }),
    saveConversion: (dto: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_SAVE_CONVERSION, { dto, actor }),
    convertToBase: (productId: string | number, enteredQuantity: number, enteredUnitId: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_CONVERT_TO_BASE, { productId, enteredQuantity, enteredUnitId }),
    convertFromBase: (productId: string | number, baseQuantity: number, targetUnitId: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_CONVERT_FROM_BASE, { productId, baseQuantity, targetUnitId }),
    convertPrice: (productId: string | number, fromUnitId: string | number, toUnitId: string | number, priceMinor: number, roundingMode?: string): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_CONVERT_PRICE, { productId, fromUnitId, toUnitId, priceMinor, roundingMode }),
    calculateReturn: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.UNITS_CALCULATE_RETURN, payload)
  },

  // Barcodes & Scale Profiles (Prompt 8)
  barcodes: {
    lookup: (businessId: string, barcode: string): Promise<any> =>
      invoke(IPC_CHANNELS.BARCODES_LOOKUP, { businessId, barcode }),
    addBarcode: (dto: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.BARCODES_ADD, { dto, actor }),
    setPrimary: (businessId: string, productId: string | number, barcodeId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BARCODES_SET_PRIMARY, { businessId, productId, barcodeId }),
    deactivate: (businessId: string, barcodeId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BARCODES_DEACTIVATE, { businessId, barcodeId }),
    listProductBarcodes: (productId: string | number): Promise<any[]> =>
      invoke(IPC_CHANNELS.BARCODES_LIST_PRODUCT, { productId }),
    listScaleProfiles: (businessId: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.SCALE_PROFILES_LIST, { businessId }),
    createScaleProfile: (dto: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.SCALE_PROFILES_CREATE, { dto, actor }),
    testScaleProfile: (barcode: string, profileIdOrProfile: any): Promise<any> =>
      invoke(IPC_CHANNELS.SCALE_PROFILES_TEST, { barcode, profileIdOrProfile })
  },

  stockLocations: {
    list: (payload?: { businessId?: string; branchId?: string; includeInactive?: boolean }): Promise<any[]> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_LIST, payload),
    getById: (id: string, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_GET_BY_ID, { id, businessId }),
    create: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_CREATE, { dto, actor }),
    update: (id: string, dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_UPDATE, { id, dto, actor }),
    archive: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_ARCHIVE, { id, actor }),
    getStock: (locationId: string, businessId?: string, filter?: any): Promise<any[]> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_GET_STOCK, { locationId, businessId, filter }),
    getProductStock: (productId: string | number, businessId?: string): Promise<any[]> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_GET_PRODUCT_STOCK, { productId, businessId }),
    transfer: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_TRANSFER, { dto, actor }),
    getMovements: (locationId: string, businessId?: string, limit?: number): Promise<any[]> =>
      invoke(IPC_CHANNELS.STOCK_LOCATIONS_MOVEMENTS, { locationId, businessId, limit })
  },

  stockAdjustments: {
    list: (filters?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_LIST, filters),
    getById: (id: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_BY_ID, { id }),
    create: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_CREATE, { input, actor }),
    submitForApproval: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_SUBMIT, { id, actor }),
    approve: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_APPROVE, { id, actor }),
    reject: (id: string, reason: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_REJECT, { id, reason, actor }),
    cancel: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_CANCEL, { id, actor }),
    post: (id: string, actor?: any, options?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_POST, { id, actor, options }),
    reverse: (id: string, reason: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_REVERSE, { id, reason, actor }),
    relocateDamaged: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_RELOCATE_DAMAGED, { input, actor }),
    writeOffDamaged: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_WRITE_OFF, { input, actor }),
    returnToSellable: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_RETURN_SELLABLE, { input, actor }),
    getPolicy: (businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_GET_POLICY, { businessId }),
    updatePolicy: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_ADJUSTMENTS_UPDATE_POLICY, { input, actor })
  },

  stocktakes: {
    list: (filter?: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_LIST, { filter, actor }),
    getById: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_GET_BY_ID, { id, actor }),
    create: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_CREATE, { dto, actor }),
    start: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_START, { id, actor }),
    recordCount: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_RECORD_COUNT, { dto, actor }),
    resolveLine: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_RESOLVE_LINE, { dto, actor }),
    submitCounts: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_SUBMIT_COUNTS, { id, actor }),
    review: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_REVIEW, { id, actor }),
    approve: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_APPROVE, { id, actor }),
    post: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_POST, { id, actor }),
    cancel: (id: string, reason: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_CANCEL, { id, reason, actor }),
    getReport: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_GET_REPORT, { id, actor }),
    getPolicy: (businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_GET_POLICY, { businessId }),
    updatePolicy: (policy: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_UPDATE_POLICY, { policy, actor }),
    checkFreeze: (stockLocationId: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCKTAKES_CHECK_FREEZE, { stockLocationId })
  },

  // Stock Transfers & In-Transit Workflow (Prompt 15)
  stockTransfers: {
    list: (filter?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_LIST, { filter }),
    getById: (id: string): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_GET_BY_ID, { id }),
    create: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_CREATE, { input, actor }),
    approve: (id: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_APPROVE, { id, actor }),
    dispatch: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_DISPATCH, { input, actor }),
    receive: (input: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_RECEIVE, { input, actor }),
    cancel: (id: string, reason: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.STOCK_TRANSFERS_CANCEL, { id, reason, actor })
  },

  // Inventory Valuation & Costing (Prompt 16)
  valuation: {
    getReport: (businessId?: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_GET_REPORT, { businessId, locationId }),
    processInbound: (input: any): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_PROCESS_INBOUND, { input }),
    processOutbound: (input: any): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_PROCESS_OUTBOUND, { input }),
    revalue: (params: any): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_REVALUE, { params }),
    allocateLandedCosts: (input: any): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_ALLOCATE_LANDED_COSTS, { input }),
    customerReturn: (input: any): Promise<any> =>
      invoke(IPC_CHANNELS.VALUATION_CUSTOMER_RETURN, { input })
  },

  // Stock Reservations (Prompt 17)
  reservations: {
    list: (filter: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_LIST, filter),
    getById: (id: string): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_GET_BY_ID, { id }),
    create: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_CREATE, { dto, actor }),
    fulfill: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_FULFILL, { dto, actor }),
    release: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_RELEASE, { dto, actor }),
    extend: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_EXTEND, { dto, actor }),
    cancel: (id: string, reason?: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_CANCEL, { id, reason, actor }),
    checkExpired: (businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.RESERVATIONS_CHECK_EXPIRED, { businessId })
  },

  // Stock Monitoring & Replenishment (Prompt 18)
  replenishment: {
    getRules: (businessId: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_GET_RULES, { businessId, locationId }),
    setRule: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_SET_RULE, { dto }),
    generateSuggestions: (filter: any): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_GENERATE_SUGGESTIONS, filter),
    listSuggestions: (filter: any): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_LIST_SUGGESTIONS, filter),
    editSuggestion: (id: string, quantityScaled: number): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_EDIT_SUGGESTION, { id, quantityScaled }),
    dismissSuggestion: (id: string): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_DISMISS_SUGGESTION, { id }),
    convertToPo: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_CONVERT_TO_PO, { dto, actor }),
    getAlerts: (businessId: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.REPLENISHMENT_GET_ALERTS, { businessId, locationId })
  },

  // Batch & Expiry Management (Prompt 19)
  batchExpiry: {
    getSettings: (productId: string | number, businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_GET_SETTINGS, { productId, businessId }),
    configureSettings: (dto: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_CONFIGURE_SETTINGS, { dto }),
    receiveBatch: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_RECEIVE, { dto, actor }),
    listBatches: (filter: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_LIST, filter),
    getById: (batchId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_GET_BY_ID, batchId),
    allocateFefo: (params: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_ALLOCATE_FEFO, params),
    customerReturn: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_CUSTOMER_RETURN, { dto, actor }),
    recall: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_RECALL, { dto, actor }),
    releaseQuarantine: (batchId: string, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_RELEASE_QUARANTINE, { batchId, actor }),
    writeOff: (dto: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_WRITE_OFF, { dto, actor }),
    transfer: (params: any, actor?: any): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_TRANSFER, { params, actor }),
    reportStock: (businessId: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_REPORT_STOCK, { businessId, locationId }),
    reportExpiringSoon: (businessId: string, daysThreshold?: number, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_REPORT_EXPIRING_SOON, { businessId, daysThreshold, locationId }),
    reportExpired: (businessId: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_REPORT_EXPIRED, { businessId, locationId }),
    reportRecalled: (businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_REPORT_RECALLED, { businessId }),
    reportValuation: (businessId: string, locationId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_REPORT_VALUATION, { businessId, locationId }),
    traceSales: (batchId: string): Promise<any> =>
      invoke(IPC_CHANNELS.BATCH_TRACE_SALES, batchId)
  },

  // Serial-Number Tracking (Prompt 20)
  serialTracking: {
    getSettings: (businessId: string, productId: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_GET_SETTINGS, { businessId, productId }),
    configureSettings: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_CONFIGURE_SETTINGS, payload),
    receiveUnits: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_RECEIVE, payload),
    allocateSale: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_ALLOCATE_SALE, payload),
    customerReturn: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_CUSTOMER_RETURN, payload),
    transfer: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_TRANSFER, payload),
    warrantyClaim: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_WARRANTY_CLAIM, payload),
    replaceDefective: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_REPLACE_DEFECTIVE, payload),
    updateStatus: (payload: any): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_UPDATE_STATUS, payload),
    search: (query: any, permissions?: any[]): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_SEARCH, { query, permissions }),
    getAudit: (businessId: string, serialIdentifier: string, permissions?: any[]): Promise<any> =>
      invoke(IPC_CHANNELS.SERIAL_GET_AUDIT, { businessId, serialIdentifier, permissions })
  },

  // Purchase Orders (Prompt 21)
  purchaseOrders: {
    getSettings: (businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.PO_GET_SETTINGS, { businessId }),
    configureSettings: (businessId: string, settings: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_CONFIGURE_SETTINGS, { businessId, settings }),
    createOrder: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_CREATE, { input, actor }),
    getById: (id: string, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PO_GET_BY_ID, { id, businessId }),
    submitApproval: (poId: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_SUBMIT_APPROVAL, { poId, actor }),
    approveOrder: (poId: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_APPROVE, { poId, actor }),
    markSent: (poId: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_MARK_SENT, { poId, actor }),
    receiveGoods: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_RECEIVE_GOODS, { input, actor }),
    recordInvoice: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_RECORD_INVOICE, { input, actor }),
    cancelOrder: (poId: string, reason: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_CANCEL, { poId, reason, actor }),
    closeOrder: (poId: string, reason: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_CLOSE, { poId, reason, actor }),
    search: (query: any): Promise<any> =>
      invoke(IPC_CHANNELS.PO_SEARCH, { query }),
    getOutstandingReport: (businessId: string, supplierId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PO_GET_OUTSTANDING_REPORT, { businessId, supplierId }),
    getLastPurchasePrice: (businessId: string, supplierId: string | number, productId: string | number): Promise<any> =>
      invoke(IPC_CHANNELS.PO_GET_LAST_PRICE, { businessId, supplierId, productId })
  },

  // Goods Receiving Notes (Prompt 22)
  goodsReceipts: {
    getSettings: (businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_GET_SETTINGS, { businessId }),
    configureSettings: (businessId: string, settings: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_CONFIGURE_SETTINGS, { businessId, settings }),
    createReceipt: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_CREATE, { input, actor }),
    getById: (id: string, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_GET_BY_ID, { id, businessId }),
    inspectReceipt: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_INSPECT, { input, actor }),
    approveReceipt: (receiptId: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_APPROVE, { receiptId, actor }),
    postReceipt: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_POST, { input, actor }),
    cancelReceipt: (receiptId: string, reason: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_CANCEL, { receiptId, reason, actor }),
    search: (query: any): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_SEARCH, { query }),
    getDiscrepancyReport: (businessId: string, purchaseOrderId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.GRN_GET_DISCREPANCY_REPORT, { businessId, purchaseOrderId })
  },

  // Supplier Purchase Invoices (Prompt 23)
  purchaseInvoices: {
    getSettings: (businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_GET_SETTINGS, { businessId }),
    configureSettings: (businessId: string, settings: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_CONFIGURE_SETTINGS, { businessId, settings }),
    createInvoice: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_CREATE, { input, actor }),
    updateInvoice: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_UPDATE, { input, actor }),
    getById: (id: string, businessId?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_GET_BY_ID, { id, businessId }),
    listInvoices: (filter: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_LIST, { filter }),
    postInvoice: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_POST, { input, actor }),
    voidInvoice: (invoiceId: string, reason: string, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_VOID, { invoiceId, reason, actor }),
    allocatePayment: (input: any, actor: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_ALLOCATE_PAYMENT, { input, actor }),
    matchThreeWay: (purchaseInvoiceId: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_MATCH_3WAY, { purchaseInvoiceId }),
    importGrns: (receiptIds: string[], businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_IMPORT_GRNS, { receiptIds, businessId }),
    getPeriods: (businessId: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_GET_PERIODS, { businessId }),
    createPeriod: (period: any): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_CREATE_PERIOD, { period }),
    closePeriod: (periodId: string, closedBy?: string): Promise<any> =>
      invoke(IPC_CHANNELS.PURCHASE_INVOICE_CLOSE_PERIOD, { periodId, closedBy })
  }
};

contextBridge.exposeInMainWorld('posApi', posApi);

export type PosApi = typeof posApi;

