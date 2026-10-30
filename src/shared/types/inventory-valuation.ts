/**
 * Inventory Valuation & Costing Type Definitions (Prompt 16)
 */

export type CostingMethod = 'fifo' | 'weighted_average';

export type LandedCostAllocationMethod = 'quantity' | 'weight' | 'value' | 'manual';

export type BackdatingPolicy = 'restrict' | 'recalculate_adjustment';

export type NegativeStockPolicy = 'block' | 'provisional';

export interface InventoryCostLayer {
  id: string;
  businessId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  sourceMovementId?: string | null;
  receivedQuantityScaled: number;
  remainingQuantityScaled: number;
  unitCostMinor: number;
  currencyCode: string;
  receivedAt: string;
  createdAt: string;
  // Metadata for returns or transfers
  isRestoredReturn?: boolean;
}

export interface InventoryCostAllocation {
  id: string;
  businessId: string;
  outboundMovementId?: string | null;
  costLayerId?: string | null;
  referenceType?: string; // 'SALE', 'TRANSFER', 'ADJUSTMENT', 'SUPPLIER_RETURN'
  referenceId?: string;
  referenceLineId?: string;
  quantityScaled: number;
  unitCostMinor: number;
  allocatedCostMinor: number;
  isProvisional?: boolean;
  createdAt: string;
}

export interface InventoryCostBalance {
  id: string;
  businessId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  quantityScaled: number;
  inventoryValueMinor: number;
  averageUnitCostNumerator: number;
  averageUnitCostDenominator: number;
  updatedAt: string;
}

export interface CostingSnapshot {
  costingMethod: CostingMethod;
  costedQuantityScaled: number;
  totalCogsMinor: number;
  unitCostMinor: number;
  allocations: InventoryCostAllocation[];
  calculatedAt: string;
  currencyCode: string;
  isProvisional?: boolean;
}

export interface LandedCostItem {
  productId: string | number;
  quantityScaled: number;
  weightGrams?: number;
  baseCostMinor: number;
  manualCostMinor?: number;
}

export interface LandedCostAllocationInput {
  businessId: string;
  allocationMethod: LandedCostAllocationMethod;
  totalAdditionalCostMinor: number;
  expenseCategory: string; // e.g. 'freight', 'customs', 'handling', 'insurance'
  items: LandedCostItem[];
}

export interface LandedCostAllocationLineResult {
  productId: string | number;
  baseCostMinor: number;
  allocatedAdditionalCostMinor: number;
  effectiveUnitCostMinor: number;
  totalLandedCostMinor: number;
}

export interface LandedCostAllocationResult {
  allocationMethod: LandedCostAllocationMethod;
  totalAdditionalCostMinor: number;
  totalAllocatedMinor: number;
  lines: LandedCostAllocationLineResult[];
}

export interface InventoryRevaluation {
  id: string;
  businessId: string;
  productId: string | number;
  stockLocationId: string;
  oldCostMethod: CostingMethod;
  newCostMethod: CostingMethod;
  oldInventoryValueMinor: number;
  newInventoryValueMinor: number;
  revaluationVarianceMinor: number;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

export interface ValuationValuationLine {
  productId: string | number;
  productName: string;
  sku: string;
  costMethod: CostingMethod;
  quantityScaled: number;
  unitCostMinor: number;
  totalValueMinor: number;
  layersCount?: number;
}

export interface InventoryValuationReport {
  businessId: string;
  stockLocationId?: string;
  currencyCode: string;
  totalInventoryValueMinor: number;
  totalItemsCount: number;
  generatedAt: string;
  lines: ValuationValuationLine[];
}

export interface InboundReceiptInput {
  businessId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  quantityScaled: number;
  unitCostMinor: number;
  currencyCode?: string;
  sourceMovementId?: string | null;
  receivedAt?: string;
  costMethod?: CostingMethod;
}

export interface OutboundIssueInput {
  businessId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  quantityScaled: number;
  referenceType: string; // 'SALE', 'TRANSFER', 'ADJUSTMENT', 'SUPPLIER_RETURN'
  referenceId?: string;
  referenceLineId?: string;
  outboundMovementId?: string | null;
  allowNegativeStock?: boolean;
  costMethod?: CostingMethod;
}

export interface CustomerReturnCostingInput {
  businessId: string;
  saleId?: string | number;
  saleItemId?: string | number;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  returnedQuantityScaled: number;
  isDamaged?: boolean;
  quarantineLocationId?: string;
  overrideUnitCostMinor?: number;
  costMethod?: CostingMethod;
  actorRole?: string;
}

