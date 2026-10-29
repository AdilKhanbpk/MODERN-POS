export type CustomerType = 'retail' | 'wholesale' | 'business' | 'other';

export type CreditControlPolicy = 'BLOCK' | 'REQUIRE_APPROVAL' | 'WARN' | 'IGNORE';

export interface EnterpriseCustomer {
  id: string | number;
  businessId: string;
  customerCode: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  customerType: CustomerType;
  creditLimitMinor: number;
  creditDays: number;
  openingBalanceMinor: number;
  notes?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Computed & balance properties
  balanceMinor?: number;
  calculatedBalanceMinor?: number;
  isOverdue?: boolean;
  overdueAmountMinor?: number;
  availableCreditMinor?: number;
}

export interface CreateCustomerDto {
  businessId?: string;
  customerCode?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  customerType?: CustomerType;
  creditLimitMinor?: number;
  creditDays?: number;
  openingBalanceMinor?: number;
  notes?: string | null;
  isActive?: boolean;
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {
  id?: string | number;
}

export interface EnterpriseCustomerLedgerEntry {
  id: string | number;
  businessId: string;
  branchId?: string | null;
  customerId: string | number;
  entryType: string;
  referenceType?: string | null;
  referenceId?: string | number | null;
  debitMinor: number;
  creditMinor: number;
  currencyCode: string;
  description?: string | null;
  entryDate?: string;
  createdAt?: string;
  createdBy?: string | number | null;
  reversalOfEntryId?: string | number | null;
  runningBalanceMinor?: number;
}

export interface CustomerPaymentAllocation {
  id: string | number;
  businessId: string;
  paymentId: string | number;
  salesDocumentId: string | number;
  allocatedMinor: number;
  createdAt?: string;
  // Metadata for display
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceTotalMinor?: number;
  previouslyPaidMinor?: number;
  remainingDueMinor?: number;
}

export interface AllocatePaymentDto {
  businessId?: string;
  paymentId: string | number;
  allocations: Array<{
    salesDocumentId: string | number;
    amountMinor: number;
  }>;
}

export interface OutstandingInvoice {
  salesDocumentId: string | number;
  saleNumber: string;
  saleDate: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  creditDays: number;
  dueDate: string;
  isOverdue: boolean;
  overdueDays: number;
}

export interface CreditCheckResult {
  allowed: boolean;
  policy: CreditControlPolicy;
  creditLimitMinor: number;
  currentBalanceMinor: number;
  newCreditMinor: number;
  totalExposureMinor: number;
  exceedsLimit: boolean;
  isOverdue: boolean;
  overdueInvoices: OutstandingInvoice[];
  requiresApproval: boolean;
  warningMessage?: string;
  errorMessage?: string;
}

export interface RecordCustomerPaymentDto {
  businessId?: string;
  branchId?: string;
  customerId: string | number;
  amountMinor: number;
  paymentMethod?: string;
  paymentMethodId?: number;
  cashSessionId?: number;
  reference?: string;
  notes?: string;
  allocations?: Array<{
    salesDocumentId: string | number;
    amountMinor: number;
  }>;
}

export interface CustomerStatementSummary {
  customerId: string | number;
  customerCode: string;
  customerName: string;
  customerType: CustomerType;
  creditLimitMinor: number;
  creditDays: number;
  openingBalanceMinor: number;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  closingBalanceMinor: number;
  isReconciled: boolean;
  discrepancyMinor: number;
  entries: EnterpriseCustomerLedgerEntry[];
}

