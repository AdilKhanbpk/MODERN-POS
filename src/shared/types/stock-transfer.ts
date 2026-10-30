export type StockTransferType =
  | 'internal'
  | 'inter_branch'
  | 'INTERNAL_LOCATION'
  | 'BRANCH_TRANSFER';

export type StockTransferStatus =
  | 'draft'
  | 'requested'
  | 'approved'
  | 'dispatched'
  | 'partially_received'
  | 'received'
  | 'cancelled'
  | 'rejected'
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'CANCELLED';

export type StockTransferDiscrepancyAction =
  | 'quarantine'
  | 'write_off'
  | 're_dispatch'
  | 'return_to_source';

export interface StockTransferLine {
  id: string;
  transferId: string;
  productId: string | number;
  productName?: string;
  productSku?: string;
  variantId?: string | number | null;
  batchId?: string | number | null;
  serialNumberId?: string | number | null;
  requestedQuantityScaled: number;
  dispatchedQuantityScaled: number;
  receivedQuantityScaled: number;
  rejectedQuantityScaled: number;
  lossQuantityScaled: number;
  unitId: string | number;
  unitName?: string;
  unitCostMinor?: number | null;
  quantityScaled: number; // legacy compatibility
  notes?: string | null;
}

export interface StockTransferReceiptLine {
  id: string;
  receiptId: string;
  transferLineId: string;
  productId: string | number;
  productName?: string;
  receivedQuantityScaled: number;
  rejectedQuantityScaled: number;
  lossQuantityScaled: number;
  rejectedLocationId?: string | null;
  rejectedLocationName?: string;
  discrepancyReason?: string | null;
  discrepancyAction?: StockTransferDiscrepancyAction | null;
  notes?: string | null;
}

export interface StockTransferReceipt {
  id: string;
  transferId: string;
  receiptNumber: string;
  receivedBy: string | number;
  receiverName?: string;
  receivedAt: string;
  notes?: string | null;
  lines?: StockTransferReceiptLine[];
}

export interface StockTransfer {
  id: string;
  businessId: string;
  transferNumber: string;
  transferType: StockTransferType;
  sourceBranchId: string;
  sourceBranchName?: string;
  sourceLocationId: string;
  sourceLocationName?: string;
  destinationBranchId: string;
  destinationBranchName?: string;
  destinationLocationId: string;
  destinationLocationName?: string;
  inTransitLocationId?: string | null;
  inTransitLocationName?: string;
  status: StockTransferStatus;
  requestedBy?: string | number | null;
  requesterName?: string;
  approvedBy?: string | number | null;
  approverName?: string;
  dispatchedBy?: string | number | null;
  dispatcherName?: string;
  receivedBy?: string | number | null;
  receiverName?: string;
  requestedAt?: string | null;
  approvedAt?: string | null;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  lines?: StockTransferLine[];
  receipts?: StockTransferReceipt[];
}

export interface CreateStockTransferLineInput {
  productId: string | number;
  variantId?: string | number | null;
  batchId?: string | number | null;
  serialNumberId?: string | number | null;
  requestedQuantityScaled: number;
  unitId?: string | number;
  unitCostMinor?: number;
  notes?: string;
}

export interface CreateStockTransferInput {
  businessId?: string;
  sourceBranchId?: string;
  destinationBranchId?: string;
  sourceLocationId: string;
  destinationLocationId: string;
  transferType?: StockTransferType;
  notes?: string | null;
  idempotencyKey?: string;
  lines: CreateStockTransferLineInput[];
  autoSubmit?: boolean;
}

export interface DispatchStockTransferInput {
  transferId: string;
  notes?: string | null;
  dispatchedLines?: Array<{
    lineId: string;
    dispatchedQuantityScaled?: number; // Defaults to requestedQuantityScaled
  }>;
}

export interface ReceiveTransferLineItem {
  lineId: string;
  receivedQuantityScaled: number;
  rejectedQuantityScaled?: number;
  lossQuantityScaled?: number;
  rejectedLocationId?: string | null;
  discrepancyReason?: string | null;
  discrepancyAction?: StockTransferDiscrepancyAction | null;
  notes?: string | null;
}

export interface ReceiveStockTransferInput {
  transferId: string;
  notes?: string | null;
  lines: ReceiveTransferLineItem[];
}

export interface StockTransferFilter {
  businessId: string;
  branchId?: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  status?: StockTransferStatus;
  transferType?: StockTransferType;
  page?: number;
  limit?: number;
}

export interface TransferActorContext {
  userId: string | number;
  role: string;
  businessId: string;
  branchId?: string;
}

