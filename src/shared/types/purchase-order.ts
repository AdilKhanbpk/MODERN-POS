export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'fully_received'
  | 'partially_invoiced'
  | 'fully_invoiced'
  | 'closed'
  | 'cancelled';

export type OverDeliveryPolicy = 'reject' | 'allow_tolerance' | 'require_approval';

export interface PurchaseOrderSettings {
  id: string;
  businessId: string;
  overDeliveryPolicy: OverDeliveryPolicy;
  overDeliveryTolerancePercent: number; // e.g. 5 for 5%
  requireApprovalAboveMinor: number; // e.g. 10000000 for Rs 100,000
  allowSelfApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName?: string;
  productSku?: string;
  variantId?: string | null;
  variantSku?: string | null;
  orderedQuantityScaled: number; // e.g. 10000 for 10 units
  receivedQuantityScaled: number;
  invoicedQuantityScaled: number;
  purchaseUnitId: string;
  purchaseUnitName?: string;
  conversionNumerator: number;
  conversionDenominator: number;
  baseQuantityScaled: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  taxProfileId?: string | null;
  taxRatePercent?: number;
  taxMinor: number;
  lineTotalMinor: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;

  // Virtual / helper fields
  outstandingQuantityScaled?: number;
  uninvoicedQuantityScaled?: number;
}

export interface PurchaseOrder {
  id: string;
  businessId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  supplierCode?: string;
  purchaseOrderNumber: string;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  currencyCode: string;
  exchangeRateNumerator: number;
  exchangeRateDenominator: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  otherChargesMinor: number;
  totalMinor: number;
  status: PurchaseOrderStatus;
  paymentTermsDays: number;
  notes?: string | null;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  sentAt?: string | null;
  closedAt?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderLineInput {
  productId: string | number;
  variantId?: string | number | null;
  orderedQuantityScaled: number;
  purchaseUnitId: string | number;
  conversionNumerator?: number;
  conversionDenominator?: number;
  unitPriceMinor: number;
  lineDiscountMinor?: number;
  taxProfileId?: string | null;
  taxRatePercent?: number;
  notes?: string;
}

export interface CreatePurchaseOrderInput {
  businessId?: string;
  branchId?: string;
  supplierId: string | number;
  purchaseOrderNumber?: string;
  orderDate?: string;
  expectedDeliveryDate?: string | null;
  currencyCode?: string;
  exchangeRateNumerator?: number;
  exchangeRateDenominator?: number;
  discountMinor?: number;
  shippingMinor?: number;
  otherChargesMinor?: number;
  paymentTermsDays?: number;
  notes?: string;
  idempotencyKey?: string;
  lines: CreatePurchaseOrderLineInput[];
  submitForApproval?: boolean;
}

export interface UpdatePurchaseOrderInput {
  expectedDeliveryDate?: string | null;
  discountMinor?: number;
  shippingMinor?: number;
  otherChargesMinor?: number;
  paymentTermsDays?: number;
  notes?: string;
  lines?: CreatePurchaseOrderLineInput[];
}

export interface GoodsReceiptLineInput {
  purchaseOrderLineId: string;
  receivedQuantityScaled: number;
  stockLocationId?: string;
  batchNumber?: string;
  expiryDate?: string;
  manufacturingDate?: string;
  serialNumbers?: string[];
  notes?: string;
}

export interface ReceiveGoodsInput {
  purchaseOrderId: string;
  receiptNumber?: string;
  stockLocationId: string;
  receiptDate?: string;
  lines: GoodsReceiptLineInput[];
  managerApproved?: boolean;
  managerOverrideReason?: string;
  notes?: string;
}

export interface PurchaseInvoiceLineInput {
  purchaseOrderLineId: string;
  invoicedQuantityScaled: number;
  invoicedUnitPriceMinor?: number;
  notes?: string;
}

export interface RecordPurchaseInvoiceInput {
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceDate?: string;
  dueDate?: string;
  lines: PurchaseInvoiceLineInput[];
  notes?: string;
}

export interface PurchaseOrderFilterQuery {
  businessId: string;
  branchId?: string;
  supplierId?: string;
  status?: PurchaseOrderStatus | PurchaseOrderStatus[];
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface OutstandingDeliveryReportItem {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  purchaseUnitName: string;
  orderedQuantityScaled: number;
  receivedQuantityScaled: number;
  outstandingQuantityScaled: number;
  unitPriceMinor: number;
  outstandingValueMinor: number;
  isOverdue: boolean;
}
