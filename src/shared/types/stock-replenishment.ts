/**
 * Stock Monitoring & Replenishment Types & Contracts (Prompt 18)
 */

export type ReplenishmentSuggestionStatus = 'open' | 'converted' | 'dismissed';

export type ReplenishmentUrgency = 'OUT_OF_STOCK' | 'BELOW_MINIMUM' | 'BELOW_REORDER_POINT' | 'ADEQUATE';

export interface ProductReorderRule {
  id: string;
  businessId: string;
  productId: string | number;
  stockLocationId?: string | null;
  minimumStockScaled: number;
  reorderPointScaled: number;
  targetStockScaled: number;
  preferredSupplierId?: string | number | null;
  preferredPurchaseUnitId?: string | number | null;
  leadTimeDays: number;
  safetyStockScaled: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  productName?: string;
  sku?: string;
  locationName?: string;
  supplierName?: string;
  purchaseUnitName?: string;
}

export interface CalculationReason {
  method: 'SIMPLE_REORDER' | 'DEMAND_LEAD_TIME' | 'MINIMUM_FALLBACK';
  analysisPeriodDays: number;
  averageDailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  onHand: number;
  reserved: number;
  available: number;
  inTransitIncoming?: number;
  onOrderPO?: number;
  projectedAvailable: number;
  rawShortfall: number;
  suggestedQuantity: number;
  packagingUnit?: string;
  conversionFactor?: number;
  packagesCount?: number;
  roundedQuantity?: number;
  roundingNote?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  flags?: string[]; // e.g. ['NEW_PRODUCT', 'ZERO_SALES', 'PROMOTION_SPIKE_DETECTED']
  explanation: string;
}

export interface ReplenishmentSuggestion {
  id: string;
  businessId: string;
  branchId: string;
  productId: string | number;
  stockLocationId: string;
  suggestedQuantityScaled: number;
  currentAvailableScaled: number;
  targetStockScaled: number;
  calculationReason: CalculationReason;
  status: ReplenishmentSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  productName?: string;
  sku?: string;
  locationName?: string;
  branchName?: string;
  preferredSupplierId?: string | number | null;
  preferredSupplierName?: string;
  urgency?: ReplenishmentUrgency;
  estimatedCostMinor?: number;
}

export interface UpsertReorderRuleDto {
  businessId: string;
  productId: string | number;
  stockLocationId?: string | null;
  minimumStockScaled: number;
  reorderPointScaled?: number;
  targetStockScaled: number;
  preferredSupplierId?: string | number | null;
  preferredPurchaseUnitId?: string | number | null;
  leadTimeDays?: number;
  safetyStockScaled?: number;
  isActive?: boolean;
}

export interface GenerateSuggestionsFilter {
  businessId: string;
  branchId?: string;
  stockLocationId?: string;
  supplierId?: string | number;
  historyPeriodDays?: number; // default 30 days
  includeIncoming?: boolean;  // include in-transit & PO on-order
}

export interface SuggestionListFilter {
  businessId: string;
  branchId?: string;
  stockLocationId?: string;
  supplierId?: string | number;
  status?: ReplenishmentSuggestionStatus;
  urgency?: ReplenishmentUrgency;
  search?: string;
}

export interface ConvertSuggestionsToPoDto {
  businessId: string;
  supplierId: string | number;
  locationId?: string;
  suggestionIds: string[];
  notes?: string;
  actorUserId: string | number;
}

export interface StockAlert {
  id: string;
  type: 'OUT_OF_STOCK' | 'BELOW_MINIMUM' | 'BELOW_REORDER_POINT' | 'EXPIRING_STOCK';
  productId: string | number;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  currentStock: number;
  availableStock: number;
  threshold: number;
  message: string;
  createdAt: string;
}

