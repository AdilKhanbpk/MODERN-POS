export type StockAdjustmentType =
  | 'increase'
  | 'decrease'
  | 'damage'
  | 'expiry'
  | 'correction'
  | 'other';

export type StockAdjustmentReasonCode =
  | 'DAMAGED'
  | 'EXPIRED'
  | 'MISSING'
  | 'THEFT'
  | 'BROKEN'
  | 'FOUND_STOCK'
  | 'DATA_CORRECTION'
  | 'OPENING_BALANCE_CORRECTION'
  | 'OTHER';

export type StockAdjustmentStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'posted'
  | 'rejected'
  | 'cancelled';

export interface StockAdjustmentLine {
  id: string;
  adjustmentId: string;
  productId: string;
  productName?: string;
  productSku?: string;
  variantId?: string | null;
  variantSku?: string | null;
  batchId?: string | null;
  systemQuantityScaled: number;
  countedQuantityScaled: number;
  differenceQuantityScaled: number;
  unitId: string;
  unitName?: string;
  unitCostMinor?: number | null;
  totalValueMinor?: number | null;
  reason?: string | null;
  createdAt?: string;
}

export interface EnterpriseStockAdjustment {
  id: string;
  businessId: string;
  branchId: string;
  adjustmentNumber: string;
  stockLocationId: string;
  stockLocationName?: string;
  adjustmentType: StockAdjustmentType;
  reasonCode: StockAdjustmentReasonCode;
  reasonDescription: string;
  status: StockAdjustmentStatus;
  requestedBy: string;
  requestedByName?: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  postedBy?: string | null;
  postedByName?: string | null;
  requestedAt: string;
  approvedAt?: string | null;
  postedAt?: string | null;
  idempotencyKey: string;
  reversalOfId?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: StockAdjustmentLine[];
  totalDifferenceScaled?: number;
  totalValueImpactMinor?: number;
}

export interface EnterpriseStockAdjustmentDetail extends EnterpriseStockAdjustment {
  lines: StockAdjustmentLine[];
}

export interface CreateStockAdjustmentLineInput {
  productId: string | number;
  variantId?: string | number | null;
  batchId?: string | null;
  countedQuantityScaled: number;
  unitId?: string | number;
  unitCostMinor?: number;
  reason?: string;
}

export interface CreateStockAdjustmentInput {
  businessId?: string;
  branchId?: string;
  stockLocationId: string;
  adjustmentType: StockAdjustmentType;
  reasonCode: StockAdjustmentReasonCode;
  reasonDescription: string;
  lines: CreateStockAdjustmentLineInput[];
  idempotencyKey?: string;
  autoPostIfPermitted?: boolean;
}

export interface StockAdjustmentApprovalPolicy {
  id: string;
  businessId: string;
  maxAutoApproveQtyScaled: number; // e.g. 5000 = 5 units
  maxAutoApproveValueMinor: number; // e.g. 500000 = Rs. 5,000
  requireApprovalForTypes: StockAdjustmentType[];
  allowSelfApproval: boolean;
  approverRoles: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateApprovalPolicyInput {
  businessId?: string;
  maxAutoApproveQtyScaled?: number;
  maxAutoApproveValueMinor?: number;
  requireApprovalForTypes?: StockAdjustmentType[];
  allowSelfApproval?: boolean;
  approverRoles?: string[];
}

export interface StockAdjustmentFilters {
  businessId?: string;
  branchId?: string;
  stockLocationId?: string;
  status?: StockAdjustmentStatus;
  adjustmentType?: StockAdjustmentType;
  reasonCode?: StockAdjustmentReasonCode;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedAdjustmentsResult {
  items: EnterpriseStockAdjustment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RelocateDamagedInput {
  businessId?: string;
  branchId?: string;
  productId: string | number;
  variantId?: string | number | null;
  fromLocationId: string;
  toDamagedLocationId: string;
  quantityScaled: number;
  reasonDescription: string;
}

export interface WriteOffDamagedInput {
  businessId?: string;
  branchId?: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  quantityScaled: number;
  reasonDescription: string;
}

export interface ReturnToSellableInput {
  businessId?: string;
  branchId?: string;
  productId: string | number;
  variantId?: string | number | null;
  fromDamagedLocationId: string;
  toSellableLocationId: string;
  quantityScaled: number;
  reasonDescription: string;
}

export interface StockRelocationResult {
  transferOutMovementId: string;
  transferInMovementId: string;
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantityScaled: number;
}

export interface ActorContext {
  userId: string | number;
  role: string;
  businessId: string;
  branchId?: string;
  overrideLocationFreeze?: boolean;
}
