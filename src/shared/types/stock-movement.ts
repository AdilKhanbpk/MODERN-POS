/**
 * Stock Movement Ledger Types (Prompt 12)
 * The authoritative, immutable record of every inventory change.
 */

export type StockMovementType =
  | 'PURCHASE_RECEIPT'
  | 'CUSTOMER_RETURN'
  | 'ADJUSTMENT_INCREASE'
  | 'SALE'
  | 'SUPPLIER_RETURN'
  | 'DAMAGE_WRITEOFF'
  | 'ADJUSTMENT_DECREASE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_DISPATCH'
  | 'TRANSFER_RECEIPT'
  | 'TRANSFER_REJECTED'
  | 'TRANSFER_LOSS'
  | 'STOCKTAKE_SURPLUS'
  | 'STOCKTAKE_DEFICIT'
  | 'OPENING_STOCK';

export type StockMovementDirection = 'IN' | 'OUT';

export interface EnterpriseStockMovement {
  id: string;
  businessId: string;
  branchId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  batchId?: string | number | null;
  serialNumberId?: string | number | null;
  movementType: StockMovementType;
  direction: StockMovementDirection;
  quantityScaled: number; // strictly positive magnitude BIGINT
  baseUnitId: string | number;
  unitPrecision: number;
  unitCostMinor?: number | null;
  totalCostMinor?: number | null;
  currencyCode?: string | null;
  referenceType: string;
  referenceId: string;
  referenceLineId?: string | null;
  idempotencyKey: string;
  payloadHash?: string | null;
  occurredAt: string;
  postedAt: string;
  createdBy?: string | number | null;
  createdAt: string;

  // Joined metadata for UI/Reports
  productName?: string;
  productSku?: string;
  locationName?: string;
  branchName?: string;
  baseUnitName?: string;
}

export interface PostStockMovementInput {
  businessId: string;
  branchId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  batchId?: string | number | null;
  serialNumberId?: string | number | null;
  movementType: StockMovementType;
  quantityScaled: number; // Strictly positive magnitude in scaled units (e.g. 1000 = 1.000)
  unitCostMinor?: number | null;
  currencyCode?: string | null;
  referenceType: string;
  referenceId: string;
  referenceLineId?: string | null;
  idempotencyKey: string;
  occurredAt?: string;
  createdBy?: string | number | null;
  allowNegativeStockOverride?: boolean;
}

export interface StockReconciliationResult {
  productId: string | number;
  productName: string;
  productSku?: string;
  stockLocationId: string;
  locationName: string;
  variantId?: string | number | null;
  cachedOnHandScaled: number;
  calculatedOnHandScaled: number;
  cachedReservedScaled: number;
  calculatedReservedScaled: number;
  isDiscrepant: boolean;
  discrepancyScaled: number;
  totalInboundScaled: number;
  totalOutboundScaled: number;
  movementCount: number;
}

export interface RepairStockBalanceInput {
  businessId: string;
  branchId: string;
  productId: string | number;
  stockLocationId: string;
  variantId?: string | number | null;
  reason: string;
  authorizedBy: string | number;
}

