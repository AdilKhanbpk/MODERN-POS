export type PurchaseInvoiceStatus =
  | 'draft'
  | 'pending_approval'
  | 'posted'
  | 'partially_paid'
  | 'paid'
  | 'voided';

export type DuplicateInvoicePolicy = 'block' | 'warn' | 'allow';

export type ThreeWayMatchStatus = 'exact_match' | 'acceptable_variance' | 'variance_exceeded' | 'quantity_mismatch' | 'no_po_reference';

export interface PurchaseInvoiceLine {
  id: string;
  purchaseInvoiceId: string;
  goodsReceiptLineId?: string | null;
  purchaseOrderLineId?: string | null;
  productId: string;
  productName?: string;
  productSku?: string;
  variantId?: string | null;
  batchId?: string | null;
  descriptionSnapshot?: string | null;
  quantityScaled: number; // e.g. 100000 = 100.000 units
  unitId: string;
  unitName?: string;
  conversionNumerator: number;
  conversionDenominator: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxProfileId?: string | null;
  taxMinor: number;
  lineTotalMinor: number;
  allocations?: PurchaseInvoiceReceiptAllocation[];
}

export interface PurchaseInvoiceReceiptAllocation {
  id: string;
  purchaseInvoiceLineId: string;
  goodsReceiptLineId: string;
  allocatedQuantityScaled: number;
  createdAt: string;
}

export interface PurchaseInvoice {
  id: string;
  businessId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  supplierCode?: string;
  invoiceNumber: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate: string; // YYYY-MM-DD
  dueDate?: string | null;
  currencyCode: string;
  exchangeRateNumerator: number;
  exchangeRateDenominator: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  otherChargesMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: PurchaseInvoiceStatus;
  notes?: string | null;
  createdBy: string;
  createdByName?: string;
  postedBy?: string | null;
  postedByName?: string | null;
  postedAt?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseInvoiceLine[];
}

export interface PurchaseInvoiceSettings {
  id: string;
  businessId: string;
  duplicateInvoicePolicy: DuplicateInvoicePolicy;
  priceVarianceThresholdMinor: number;
  priceVarianceThresholdPercent: number;
  allowInvoiceBeforeGrn: boolean;
  allowOverInvoicing: boolean;
  closedPeriodBeforeDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingPeriod {
  id: string;
  businessId: string;
  periodName: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  closedAt?: string | null;
  closedBy?: string | null;
  createdAt: string;
}

export interface PurchaseInvoiceLineInput {
  goodsReceiptLineId?: string | null;
  purchaseOrderLineId?: string | null;
  productId: string | number;
  variantId?: string | null;
  batchId?: string | null;
  descriptionSnapshot?: string | null;
  quantityScaled: number;
  unitId: string | number;
  conversionNumerator?: number;
  conversionDenominator?: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxProfileId?: string | null;
  taxMinor?: number;
  isTaxInclusive?: boolean;
  taxRatePercent?: number;
  allocations?: Array<{
    goodsReceiptLineId: string;
    allocatedQuantityScaled: number;
  }>;
}

export interface CreatePurchaseInvoiceInput {
  businessId: string;
  branchId: string;
  supplierId: string;
  invoiceNumber?: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  currencyCode?: string;
  exchangeRateNumerator?: number;
  exchangeRateDenominator?: number;
  shippingMinor?: number;
  otherChargesMinor?: number;
  notes?: string | null;
  idempotencyKey?: string;
  status?: PurchaseInvoiceStatus;
  lines: PurchaseInvoiceLineInput[];
}

export interface UpdatePurchaseInvoiceInput {
  id: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  shippingMinor?: number;
  otherChargesMinor?: number;
  notes?: string | null;
  lines?: PurchaseInvoiceLineInput[];
}

export interface PostPurchaseInvoiceInput {
  purchaseInvoiceId: string;
  managerApproved?: boolean;
  reconcileCostLayers?: boolean;
}

export interface AllocateInvoicePaymentInput {
  purchaseInvoiceId: string;
  amountMinor: number;
  paymentMethod: string;
  paymentDate?: string;
  notes?: string;
}

export interface ThreeWayMatchLineComparison {
  purchaseInvoiceLineId: string;
  productId: string;
  productName: string;
  unitId: string;
  unitName: string;

  // Purchase Order
  purchaseOrderLineId?: string | null;
  orderedQuantityScaled?: number | null;
  poUnitPriceMinor?: number | null;

  // Goods Receipt
  goodsReceiptLineId?: string | null;
  acceptedQuantityScaled?: number | null;
  grnUnitCostMinor?: number | null;

  // Invoice
  invoicedQuantityScaled: number;
  invoicedUnitPriceMinor: number;

  // Variances
  quantityVarianceScaled: number; // Invoiced - Accepted
  unitPriceVarianceMinor: number; // Invoiced - Ordered (or GRN)
  priceVariancePercent: number;
  totalFinancialVarianceMinor: number;

  status: ThreeWayMatchStatus;
  notes?: string;
}

export interface ThreeWayMatchReport {
  purchaseInvoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  overallStatus: ThreeWayMatchStatus;
  requiresManagerApproval: boolean;
  totalOrderedQuantityScaled: number;
  totalAcceptedQuantityScaled: number;
  totalInvoicedQuantityScaled: number;
  totalPriceVarianceMinor: number;
  lines: ThreeWayMatchLineComparison[];
}

export interface PurchaseInvoiceFilterQuery {
  businessId: string;
  branchId?: string;
  supplierId?: string;
  status?: PurchaseInvoiceStatus | PurchaseInvoiceStatus[];
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  limit?: number;
  offset?: number;
}

