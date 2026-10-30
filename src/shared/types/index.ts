import { Role, Permission } from '../constants/roles-permissions';
import { PaymentMethod, SaleStatus, StockMovementType, AccountType } from '../constants/accounts';

import { ProductBarcode } from './barcode';
import { ProductUnitConversion } from './unit-conversion';

export { Role, Permission, PaymentMethod, SaleStatus, StockMovementType, AccountType };
export * from './enterprise-core';
export * from './onboarding';
export * from './auth-security';
export * from './product-catalogue';
export * from './unit-conversion';
export * from './barcode';
export * from './customer';
export * from './supplier';
export * from './serial-tracking';
export * from './purchase-order';
export * from './goods-receipt';

// -------------------------------------------------------------
// GROUP A: Business Settings, Security & Sequences
// -------------------------------------------------------------

export interface BusinessSettings {
  id: number;
  businessName: string;
  address?: string;
  phone?: string;
  logoPath?: string;
  currencyCode: string;
  currencyPrecision: number;
  timezone: string;
  updatedAt: string;
}

export interface AppSetting {
  settingKey: string;
  settingValue: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface RoleEntity {
  id: number;
  name: string;
  description?: string;
}

export interface PermissionEntity {
  id: number;
  permissionKey: string;
  description?: string;
}

export interface AuditLog {
  id: number;
  userId?: number;
  action: string;
  entityType: string;
  entityId?: number;
  reason?: string;
  details?: string;
  createdAt: string;
}

export interface DocumentSequence {
  id: number;
  documentType: string;
  prefix: string;
  nextNumber: number;
}

// -------------------------------------------------------------
// GROUP B: Categories, Products, Variants, Units & Pricing
// -------------------------------------------------------------

export interface Category {
  id: number;
  parentId?: number;
  name: string;
  isActive: boolean;
}

export interface Brand {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Unit {
  id: number;
  name: string;
  symbol: string;
  dimension: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH';
  precisionScale: number;
}

export interface ProductVariant {
  id: number;
  productId: number;
  variantSku: string;
  size?: string;
  color?: string;
  model?: string;
  costMinor?: number;
  priceMinor?: number;
  isActive: boolean;
}

export interface LegacyProductBarcode {
  id: number;
  productId: number;
  variantId?: number;
  barcode: string;
  unitId: number;
}

export interface LegacyProductUnitConversion {
  id: number;
  productId: number;
  unitId: number;
  unitName?: string;
  baseUnitsNumerator: number;
  baseUnitsDenominator: number;
}

export interface ProductPrice {
  id: number;
  productId: number;
  variantId?: number;
  unitId: number;
  priceType: 'RETAIL' | 'WHOLESALE' | 'SPECIAL';
  priceMinor: number;
}

export interface ProductBatch {
  id: number;
  productId: number;
  batchNumber: string;
  expiryDate?: string;
  costMinor: number;
  createdAt: string;
}

export interface ProductSerialNumber {
  id: number;
  productId: number;
  variantId?: number;
  serialNumber: string;
  status: 'IN_STOCK' | 'SOLD' | 'DEFECTIVE' | 'RETURNED_TO_SUPPLIER' | 'UNDER_WARRANTY';
}

export interface Product {
  id: number;
  businessId?: string;
  allowNegativeStock?: boolean;
  sku: string;
  barcode: string;
  name: string;
  description?: string;
  productType?: string;
  categoryId: number;
  categoryName?: string;
  brandId?: number;
  brandName?: string;
  baseUnitId: number;
  baseUnit: string;
  costPrice: number; // mapped to default_cost_minor
  sellingPrice: number; // mapped to default_sale_price_minor
  defaultCostMinor?: number;
  defaultSalePriceMinor?: number;
  currentStock: number;
  minStockLevel: number;
  reorderLevelScaled?: number;
  trackingMode: 'STANDARD' | 'BATCH' | 'SERIAL';
  taxRate: number;
  isTaxInclusive: boolean;
  isActive: boolean;
  createdAt: string;
  barcodes?: ProductBarcode[];
  variants?: ProductVariant[];
  conversions?: ProductUnitConversion[];
  units?: any[];
}

// -------------------------------------------------------------
// GROUP C: Inventory & Stock Ledger
// -------------------------------------------------------------

export interface Location {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Register {
  id: number;
  locationId: number;
  name: string;
  isActive: boolean;
}

export interface StockMovement {
  id: number;
  productId: number;
  variantId?: number;
  locationId: number;
  batchId?: number;
  serialId?: number;
  movementType: StockMovementType | string;
  quantityBaseScaled: number;
  previousStock?: number;
  newStock?: number;
  sourceType: string;
  sourceId: number;
  reason?: string;
  userId?: number;
  createdAt: string;
}

export interface StockBalance {
  productId: number;
  variantId: number;
  locationId: number;
  batchId: number;
  quantityBaseScaled: number;
}

export interface StockAdjustment {
  id: number;
  adjustmentNumber: string;
  locationId: number;
  reason: string;
  status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  createdBy: number;
  approvedBy?: number;
  createdAt: string;
  approvedAt?: string;
  lines?: StockAdjustmentLine[];
}

export interface StockAdjustmentLine {
  id?: number;
  adjustmentId: number;
  productId: number;
  productName?: string;
  variantId?: number;
  systemQtyScaled: number;
  countedQtyScaled: number;
  differenceQtyScaled: number;
}

// -------------------------------------------------------------
// GROUP D: Customers, Suppliers & Companies
// -------------------------------------------------------------

export interface Customer {
  id: number;
  customerCode: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  balance: number; // in integer cents/paisa (+ means customer owes, - means advance credit)
  creditLimit: number;
  creditLimitMinor?: number;
  isActive: boolean;
  createdAt: string;
}

export interface Supplier {
  id: number;
  supplierCode: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  balance: number;
  isActive: boolean;
  createdAt: string;
}

export interface Company {
  id: number;
  name: string;
  companyType: 'MANUFACTURER' | 'DISTRIBUTOR' | 'WARRANTY_PROVIDER';
  phone?: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerLedgerEntry {
  id: number;
  customerId: number;
  entryType: 'OPENING_BALANCE' | 'SALE_INVOICE' | 'PAYMENT_RECEIVED' | 'SALE_RETURN' | 'ADJUSTMENT';
  debitMinor: number;
  creditMinor: number;
  runningBalance?: number;
  sourceType: string;
  sourceId?: number;
  notes?: string;
  createdAt: string;
}

export interface SupplierLedgerEntry {
  id: number;
  supplierId: number;
  entryType: 'OPENING_BALANCE' | 'PURCHASE_BILL' | 'PAYMENT_DISBURSED' | 'PURCHASE_RETURN' | 'ADJUSTMENT';
  debitMinor: number;
  creditMinor: number;
  runningBalance?: number;
  sourceType: string;
  sourceId?: number;
  notes?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// GROUP E: Sales, Purchases, Returns & Historical Snapshots
// -------------------------------------------------------------

export interface SaleLine {
  id: number;
  saleId: number;
  productId: number;
  variantId?: number;
  productNameSnapshot: string;
  skuSnapshot: string;
  unitId: number;
  unitName?: string;
  unitNameSnapshot?: string;
  quantityScaled: number;
  unitPriceMinor: number;
  discountMinor: number;
  allocatedBillDiscountMinor?: number;
  taxMinor: number;
  taxRate?: number;
  isTaxInclusive?: boolean | number;
  unitCostMinor: number;
  lineTotalMinor: number;
  lineProfitMinor?: number;
  conversionNumeratorSnapshot?: number;
  conversionDenominatorSnapshot?: number;
}

export interface Sale {
  id: number;
  invoiceNumber: string;
  customerId?: number;
  customerName?: string;
  locationId?: number;
  registerId?: number;
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  grandTotal: number;
  totalCost: number;
  profit: number;
  subtotalMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
  totalCostMinor?: number;
  profitMinor?: number;
  paymentMethod: PaymentMethod | string;
  amountPaid: number;
  changeGiven: number;
  customerBalanceChange: number;
  status: SaleStatus | string;
  notes?: string;
  createdBy?: number;
  cashierId: number;
  cashierName?: string;
  createdAt: string;
  items?: any[];
  lines?: SaleLine[];
}

export interface PurchaseLine {
  id: number;
  purchaseId: number;
  productId: number;
  variantId?: number;
  unitId: number;
  quantityScaled: number;
  unitCostMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface PurchaseOrder {
  id: number;
  purchaseNumber?: string;
  supplierId: number;
  supplierName?: string;
  supplierInvoiceNumber?: string;
  invoiceNumber?: string;
  locationId?: number;
  subtotal: number;
  additionalCost: number;
  grandTotal: number;
  subtotalMinor?: number;
  additionalCostMinor?: number;
  totalMinor?: number;
  amountPaid: number;
  status: 'DRAFT' | 'POSTED' | 'RECEIVED' | 'CANCELLED';
  notes?: string;
  createdBy?: number;
  createdAt: string;
  items?: any[];
  lines?: PurchaseLine[];
}

export interface SaleReturn {
  id: number;
  returnNumber: string;
  originalSaleId?: number;
  customerId?: number;
  locationId: number;
  reason: string;
  status: 'COMPLETED' | 'VOIDED';
  refundMinor: number;
  createdBy: number;
  createdAt: string;
  lines?: SaleReturnLine[];
}

export interface SaleReturnLine {
  id?: number;
  saleReturnId: number;
  originalSaleLineId?: number;
  productId: number;
  variantId?: number;
  quantityScaled: number;
  disposition: 'RETURN_TO_STOCK' | 'DAMAGED_WRITE_OFF' | 'WARRANTY_REPAIR';
  refundMinor: number;
}

export interface SupplierReturn {
  id: number;
  returnNumber: string;
  supplierId: number;
  originalPurchaseId?: number;
  locationId: number;
  status: 'COMPLETED' | 'VOIDED';
  reason: string;
  createdBy: number;
  createdAt: string;
  lines?: SupplierReturnLine[];
}

export interface SupplierReturnLine {
  id?: number;
  supplierReturnId: number;
  productId: number;
  variantId?: number;
  quantityScaled: number;
  costMinor: number;
}

// -------------------------------------------------------------
// GROUP F: Payments & Allocations, Cash Drawer Sessions
// -------------------------------------------------------------

export interface PaymentMethodEntity {
  id: number;
  name: string;
  methodType: 'CASH' | 'BANK' | 'DIGITAL_WALLET' | 'OTHER';
  affectsCashDrawer: boolean;
  isActive: boolean;
}

export interface Payment {
  id: number;
  paymentNumber: string;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'OTHER';
  partyId?: number;
  direction: 'INBOUND' | 'OUTBOUND';
  amountMinor: number;
  paymentMethodId: number;
  paymentMethodName?: string;
  cashSessionId?: number;
  status: 'COMPLETED' | 'VOIDED';
  notes?: string;
  createdBy: number;
  createdAt: string;
  allocations?: PaymentAllocation[];
}

export interface PaymentAllocation {
  id?: number;
  paymentId: number;
  documentType: 'SALE' | 'PURCHASE' | 'SALE_RETURN' | 'SUPPLIER_RETURN' | 'ADVANCE';
  documentId: number;
  amountMinor: number;
  createdAt?: string;
}

export interface CashSession {
  id: number;
  registerId: number;
  openedBy: number;
  openingCashMinor: number;
  closedBy?: number;
  expectedCashMinor?: number;
  countedCashMinor?: number;
  differenceMinor?: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
}

export interface CashMovement {
  id: number;
  cashSessionId: number;
  movementType: 'OPENING_FLOAT' | 'CASH_SALE' | 'CASH_SALE_REFUND' | 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'EXPENSE_PAYOUT' | 'CASH_IN' | 'CASH_OUT';
  amountMinor: number;
  direction: 'IN' | 'OUT';
  sourceType: string;
  sourceId?: number;
  notes?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// GROUP G: Expenses, Employees & Salary Obligations
// -------------------------------------------------------------

export interface ExpenseCategory {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Expense {
  id: number;
  expenseNumber?: string;
  expenseCategoryId: number;
  categoryName?: string;
  paidFromAccountId?: number;
  accountName?: string;
  paymentMethodId?: number;
  cashSessionId?: number;
  amount: number; // in cents
  amountMinor?: number;
  recipient?: string;
  description?: string;
  status?: 'PAID' | 'VOIDED';
  notes?: string;
  createdBy?: number;
  createdAt: string;
}

export interface Employee {
  id: number;
  employeeCode?: string;
  fullName: string;
  phone: string;
  designation?: string;
  joiningDate?: string;
  baseSalary: number; // in cents
  baseSalaryMinor?: number;
  isActive: boolean;
  createdAt: string;
}

export interface SalaryEntry {
  id: number;
  employeeId: number;
  employeeName?: string;
  periodStart: string;
  periodEnd: string;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  status: 'CALCULATED' | 'PARTIALLY_PAID' | 'PAID';
  createdAt: string;
}

export interface SalaryPayment {
  id: number;
  salaryEntryId: number;
  amountMinor: number;
  paymentMethodId: number;
  paymentDate: string;
}

export interface PayrollRun {
  id: number;
  employeeId: number;
  employeeName?: string;
  month: string;
  baseSalary: number;
  allowance: number;
  deduction: number;
  netPayable: number;
  status: 'PENDING' | 'PAID';
  paymentDate?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// GROUP H: Warranty & Repaired Items
// -------------------------------------------------------------

export interface WarrantyCase {
  id: number;
  caseNumber: string;
  productId: number;
  productName?: string;
  variantId?: number;
  serialId?: number;
  serialNumber?: string;
  supplierId?: number;
  companyId?: number;
  customerId?: number;
  customerName?: string;
  issueDescription: string;
  status: 'RECEIVED' | 'DISPATCHED_TO_COMPANY' | 'RETURNED_FROM_COMPANY' | 'DELIVERED_TO_CUSTOMER' | 'REJECTED';
  createdAt: string;
}

export interface WarrantyMovement {
  id: number;
  warrantyCaseId: number;
  movementType: 'INTAKE' | 'DISPATCH' | 'REPAIR_RECEIPT' | 'CUSTOMER_DELIVERY' | 'SCRAPPED';
  quantityScaled: number;
  serialId?: number;
  sourceDocumentId?: number;
  notes?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// GROUP I: Backup & Operation History
// -------------------------------------------------------------

export interface BackupHistory {
  id: number;
  backupPath: string;
  checksum?: string;
  status: 'SUCCESS' | 'FAILED';
  sizeBytes: number;
  verificationResult?: string;
  createdAt: string;
}

export interface IdempotencyKey {
  key: string;
  operationType: string;
  responsePayload: string;
  createdAt: string;
}

// -------------------------------------------------------------
// Double-Entry Accounting Chart of Accounts
// -------------------------------------------------------------

export interface Account {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  balance: number;
  isActive: boolean;
}

export interface JournalEntryLine {
  id?: number;
  journalEntryId?: number;
  accountId: number;
  accountCode?: string;
  accountName?: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface JournalEntry {
  id: number;
  entryNumber: string;
  referenceType: string;
  referenceId?: number;
  description: string;
  totalAmount: number;
  createdAt: string;
  lines: JournalEntryLine[];
}

// -------------------------------------------------------------
// POS Request/Response Contracts
// -------------------------------------------------------------

export interface CartItemInput {
  productId: number | string;
  variantId?: number;
  unitId?: number;
  unitName?: string;
  quantity: number;
  conversionFactor: number;
  unitPrice: number;
  costPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
  isTaxInclusive?: boolean;
  batchId?: string;
  batchAllocations?: Array<{ batchId: string; quantityScaled: number }>;
  serialNumbers?: string[];
  serialIds?: string[];
}

export interface SaleCalculationResult {
  subtotal: number;
  totalItemDiscount: number;
  orderDiscountAmount: number;
  totalDiscount: number;
  netTaxableAmount: number;
  totalTax: number;
  grandTotal: number;
  totalCostPrice: number;
  estimatedProfit: number;
  items: Array<CartItemInput & {
    lineGross: number;
    lineDiscount: number;
    itemDiscount?: number;
    allocatedBillDiscount?: number;
    lineNet: number;
    lineTax: number;
    lineTotal: number;
    lineCostTotal: number;
    lineProfit: number;
  }>;
}

export interface CreateSaleRequest {
  idempotencyKey?: string;
  businessId?: string;
  customerId?: number | string;
  cashierId: number;
  userId?: number | string;
  userRole?: string;
  branchId?: string;
  counterId?: string;
  locationId?: number | string;
  registerId?: number;
  items: CartItemInput[];
  orderDiscountPercent?: number;
  orderDiscountAmount?: number;
  paymentMethod?: PaymentMethod | string;
  amountPaid: number;
  isCredit?: boolean;
  splitPayments?: Array<{ method: PaymentMethod; amount: number }>;
  reservationId?: string;
  notes?: string;
}

export interface SaleItem {
  id: number;
  saleId: number;
  productId: number;
  productName: string;
  productBarcode: string;
  unitName: string;
  quantity: number;
  conversionFactor: number;
  unitPrice: number;
  costPrice: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
  lineProfit: number;
}

export interface PurchaseOrderItemInput {
  productId: number | string;
  variantId?: number | string;
  unitId?: number | string;
  unitName?: string;
  quantity: number;
  conversionFactor: number;
  unitCostPrice: number;
  sellingPrice: number;
  lineTotal?: number;
}

export interface CreatePurchaseOrderRequest {
  supplierId: number | string;
  invoiceNumber: string;
  locationId?: number | string;
  notes?: string;
  items: PurchaseOrderItemInput[];
  additionalCost: number;
  amountPaid: number;
  paymentMethod?: string;
  isCredit?: boolean;
}

export interface StockAdjustmentRequest {
  productId: number;
  variantId?: number;
  locationId?: number;
  movementType: StockMovementType;
  quantity: number;
  reason: string;
  userId: number;
}

export interface SystemSettings {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  currencySymbol: string;
  currencyCode: string;
  defaultTaxRate: number;
  isTaxInclusive: boolean;
  receiptHeader: string;
  receiptFooter: string;
  printerName?: string;
  autoPrintReceipt: boolean;
  backupPath: string;
  autoBackupOnClose: boolean;
}

export interface DailyZReport {
  date: string;
  generatedAt: string;
  totalSalesCount: number;
  grossSales: number;
  totalDiscounts: number;
  netSales: number;
  totalTax: number;
  grandTotal: number;
  totalCostOfGoodsSold: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  cashInDrawer: number;
  cardPayments: number;
  customerCreditSales: number;
  customerCreditPaymentsReceived: number;
}

export * from './stock-location';
export * from './stock-movement';
export * from './stock-adjustment';
export * from './stocktake';
export * from './stock-transfer';
export * from './inventory-valuation';
export * from './stock-reservation';
export * from './stock-replenishment';
export * from './batch-expiry';


