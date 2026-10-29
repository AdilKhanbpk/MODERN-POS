/**
 * Types: Supplier Management, Accounts Payable & Ledger
 */

export interface EnterpriseSupplier {
  id: string;
  businessId: string;
  supplierCode: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  paymentTermsDays: number;
  creditLimitMinor?: number | null;
  openingBalanceMinor: number;
  notes?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;

  // Cached / Calculated balances (Authoritative source: supplier_ledger_entries)
  balance: number; // in minor units (paisa)
  creditLimit?: number;
}

export interface CreateSupplierDto {
  businessId?: string;
  supplierCode?: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  paymentTermsDays?: number;
  creditLimitMinor?: number | null;
  openingBalanceMinor?: number;
  notes?: string | null;
  isActive?: boolean;
}

export interface UpdateSupplierDto {
  id?: string;
  name?: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  paymentTermsDays?: number;
  creditLimitMinor?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

export type SupplierLedgerEntryType =
  | 'OPENING_BALANCE'
  | 'PURCHASE_BILL'
  | 'PAYMENT_DISBURSED'
  | 'PURCHASE_RETURN'
  | 'CREDIT_NOTE'
  | 'DEBIT_ADJUSTMENT'
  | 'CREDIT_ADJUSTMENT'
  | 'PAYMENT_REVERSAL'
  | 'BILL_REVERSAL';

export interface EnterpriseSupplierLedgerEntry {
  id: string;
  businessId: string;
  branchId?: string | null;
  supplierId: string;
  entryType: SupplierLedgerEntryType | string;
  referenceType?: string | null;
  referenceId?: string | null;
  debitMinor: number;
  creditMinor: number;
  currencyCode: string;
  description?: string | null;
  entryDate: string;
  createdAt?: string;
  createdBy?: string | null;
  reversalOfEntryId?: string | null;
  runningBalance?: number;
}

export interface SupplierPayment {
  id: string;
  businessId: string;
  branchId?: string | null;
  supplierId: string;
  paymentNumber: string;
  paymentDate: string;
  amountMinor: number;
  currencyCode: string;
  paymentMethod: string;
  cashAccountId?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  status: 'POSTED' | 'REVERSED' | 'VOIDED';
  createdBy?: string | null;
  postedAt?: string;
  reversalReason?: string | null;
  reversedAt?: string | null;
  reversedBy?: string | null;
  allocations?: SupplierPaymentAllocation[];
}

export interface SupplierPaymentAllocation {
  id: string;
  businessId: string;
  supplierPaymentId: string;
  purchaseDocumentId: string;
  allocatedMinor: number;
  createdAt?: string;
  purchaseInvoiceNumber?: string;
  purchaseDate?: string;
  purchaseTotalMinor?: number;
}

export interface RecordSupplierPaymentDto {
  businessId?: string;
  branchId?: string;
  supplierId: string | number;
  paymentNumber?: string;
  paymentDate?: string;
  amountMinor: number;
  currencyCode?: string;
  paymentMethod: string;
  cashAccountId?: string;
  referenceNumber?: string;
  notes?: string;
  allocations?: Array<{
    purchaseDocumentId: string | number;
    allocatedMinor: number;
  }>;
}

export interface OutstandingPurchaseInvoice {
  purchaseId: string | number;
  invoiceNumber: string;
  purchaseDate: string;
  totalMinor: number;
  allocatedMinor: number;
  remainingDueMinor: number;
  dueDate: string;
  isOverdue: boolean;
  overdueDays: number;
}

export interface RecordSupplierReturnDto {
  businessId?: string;
  branchId?: string;
  supplierId: string | number;
  purchaseDocumentId?: string | number;
  returnNumber?: string;
  returnDate?: string;
  amountMinor: number;
  reason: string;
  currencyCode?: string;
}

export interface RecordSupplierAdjustmentDto {
  businessId?: string;
  branchId?: string;
  supplierId: string | number;
  adjustmentType: 'DEBIT' | 'CREDIT'; // DEBIT decreases payable, CREDIT increases payable
  amountMinor: number;
  reason: string;
  referenceNumber?: string;
  currencyCode?: string;
}

export interface SupplierStatementEntry {
  id: string;
  entryDate: string;
  entryType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description: string;
  debitMinor: number;   // Decreases payable (Payments, Returns)
  creditMinor: number;  // Increases payable (Purchases, Opening credit)
  runningBalanceMinor: number;
}

export interface SupplierStatementSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fromDate?: string;
  toDate?: string;
  openingBalanceMinor: number;
  totalPurchasesMinor: number;
  totalReturnsMinor: number;
  totalPaymentsMinor: number;
  totalAdjustmentsMinor: number;
  closingBalanceMinor: number;
  entries: SupplierStatementEntry[];
}

