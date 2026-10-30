export type BatchStatus = 'active' | 'quarantine' | 'expired' | 'recalled' | 'closed';

export type ExpirySalePolicy = 'block' | 'warn' | 'allow_authorized';

export type BatchCostPolicy = 'batch_specific' | 'fifo' | 'average';

export interface ProductBatchSettings {
  id: string;
  businessId: string;
  productId: string | number;
  requiresBatch: boolean;
  requiresExpiry: boolean;
  expiryWarningDays: number;
  expirySalePolicy: ExpirySalePolicy;
  batchCostPolicy: BatchCostPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBatchSettingsDto {
  businessId: string;
  productId: string | number;
  requiresBatch: boolean;
  requiresExpiry: boolean;
  expiryWarningDays?: number;
  expirySalePolicy?: ExpirySalePolicy;
  batchCostPolicy?: BatchCostPolicy;
}

export interface ProductBatch {
  id: string;
  businessId: string;
  productId: string | number;
  batchNumber: string;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  supplierId?: string | number | null;
  purchaseDocumentLineId?: string | null;
  status: BatchStatus;
  costMinor: number;
  initialQuantityScaled: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;

  // Joined metadata
  productName?: string;
  sku?: string;
  supplierName?: string;
}

export interface BatchStockBalance {
  id: string;
  businessId: string;
  batchId: string;
  stockLocationId: string;
  onHandScaled: number;
  reservedScaled: number;
  updatedAt: string;

  // Virtual / helper fields
  availableScaled?: number;
  batchNumber?: string;
  expiryDate?: string | null;
  status?: BatchStatus;
  locationName?: string;
}

export interface BatchReceiptDto {
  businessId: string;
  branchId: string;
  stockLocationId: string;
  productId: string | number;
  batchNumber: string;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  quantityScaled: number;
  unitCostMinor?: number;
  supplierId?: string | number | null;
  purchaseDocumentLineId?: string | null;
  notes?: string;
}

export interface BatchAllocation {
  batchId: string;
  batchNumber: string;
  expiryDate?: string | null;
  quantityScaled: number;
  unitCostMinor?: number;
}

export interface SaleItemBatch {
  id: string;
  businessId: string;
  saleId: string | number;
  saleItemId: string | number;
  productId: string | number;
  batchId: string;
  quantityScaled: number;
  unitCostMinor: number;
  createdAt: string;

  // Joined info
  batchNumber?: string;
  expiryDate?: string | null;
}

export interface BatchReturnDto {
  businessId: string;
  batchId: string;
  stockLocationId: string;
  quantityScaled: number;
  returnToQuarantine: boolean;
  reason: string;
  referenceType?: string;
  referenceId?: string | number;
}

export interface BatchRecallDto {
  businessId: string;
  batchId: string;
  reason: string;
  actorUserId?: string | number;
}

export interface BatchWriteOffDto {
  businessId: string;
  batchId: string;
  stockLocationId: string;
  quantityScaled: number;
  reasonCode: 'EXPIRED' | 'DAMAGED' | 'CONTAMINATED' | 'RECALLED_DESTRUCTION' | 'OTHER';
  reasonDescription: string;
  actorUserId?: string | number;
}

export interface DaysUntilExpiryResult {
  daysRemaining: number;
  isExpired: boolean;
  isExpiringToday: boolean;
  isExpiringSoon: boolean;
  status: 'EXPIRED' | 'EXPIRING_TODAY' | 'EXPIRING_SOON' | 'GOOD' | 'NO_EXPIRY';
  formattedExpiryDate: string;
}

export interface BatchReportItem {
  batchId: string;
  batchNumber: string;
  productId: string | number;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  costMinor: number;
  totalValuationMinor: number;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  daysUntilExpiry?: number | null;
  status: BatchStatus;
  supplierName?: string | null;
}

export interface BatchSaleTraceItem {
  saleId: string | number;
  invoiceNumber: string;
  saleDate: string;
  customerId?: string | number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  quantitySold: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

