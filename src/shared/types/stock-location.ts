/**
 * Stock Location & Multi-Warehouse Management Types (Prompt 11)
 * Follows enterprise multi-tenant architecture and quantity scaling.
 */

export type StockLocationType =
  | 'shop_floor'
  | 'warehouse'
  | 'storeroom'
  | 'damaged'
  | 'quarantine'
  | 'other';

export interface StockLocation {
  id: string;
  businessId: string;
  branchId: string;
  parentLocationId?: string | null;
  name: string;
  code: string;
  locationType: StockLocationType;
  isDefault: boolean;
  isSellable: boolean;
  isReceivable: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | null;
  // Resolved navigation/hierarchy metadata
  parentName?: string | null;
  branchName?: string;
}

export interface CreateStockLocationDto {
  businessId: string;
  branchId: string;
  parentLocationId?: string | null;
  name: string;
  code: string;
  locationType: StockLocationType;
  isDefault?: boolean;
  isSellable?: boolean;
  isReceivable?: boolean;
  isActive?: boolean;
}

export interface UpdateStockLocationDto {
  name?: string;
  code?: string;
  parentLocationId?: string | null;
  locationType?: StockLocationType;
  isDefault?: boolean;
  isSellable?: boolean;
  isReceivable?: boolean;
  isActive?: boolean;
}

export interface CounterStockLocation {
  id: string;
  businessId: string;
  counterId: string;
  stockLocationId: string;
  isDefault: boolean;
  createdAt?: string;
}

export interface EnterpriseStockBalance {
  id: string;
  businessId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  onHandScaled: number;
  reservedScaled: number;
  availableScaled: number;
  lastMovementAt?: string | null;
  updatedAt?: string;
  // Product info joined
  productName?: string;
  productSku?: string;
  categoryName?: string;
  baseUnitName?: string;
}

export type StockBalanceRecord = EnterpriseStockBalance;

export type TransferType = 'INTERNAL_LOCATION' | 'BRANCH_TRANSFER';
export type TransferStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface StockTransfer {
  id: string;
  businessId: string;
  transferNumber: string;
  transferType: TransferType;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  status: TransferStatus;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  completedAt?: string | null;
  items?: StockTransferLine[];
  // Joined names
  sourceLocationName?: string;
  destinationLocationName?: string;
  sourceBranchName?: string;
  destinationBranchName?: string;
}

export interface StockTransferLine {
  id: string;
  transferId: string;
  productId: string | number;
  variantId?: string | number | null;
  quantityScaled: number;
  notes?: string | null;
  productName?: string;
  productSku?: string;
}

export interface CreateTransferItemDto {
  productId: string | number;
  variantId?: string | number | null;
  quantity: number; // User unscaled or scaled quantity depending on helper
}

export interface CreateStockTransferDto {
  businessId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  transferType?: TransferType;
  notes?: string;
  items: Array<{
    productId: string | number;
    variantId?: string | number | null;
    quantityScaled: number;
    notes?: string;
  }>;
}

export interface LocationStockFilter {
  productId?: string | number;
  categoryId?: string | number;
  search?: string;
  onlyInStock?: boolean;
}
