export type StocktakeCountMode = 'full' | 'cycle' | 'category' | 'selected_products';
export type StocktakeCountingMode = 'blind' | 'visible';
export type StocktakeStatus =
  | 'draft'
  | 'in_progress'
  | 'count_submitted'
  | 'review'
  | 'approved'
  | 'posted'
  | 'cancelled';

export type StocktakeLineStatus =
  | 'uncounted'
  | 'counted'
  | 'recount_required'
  | 'resolved'
  | 'disputed'
  | 'abandoned';

export type DiscrepancyResolutionAction =
  | 'accept_sequence'
  | 'supervisor_override'
  | 'abandon';

export interface StocktakeCountEntry {
  id: string;
  stocktakeLineId: string;
  countSequence: number;
  countedQuantityScaled: number;
  countedBy: string;
  counterName?: string;
  countedAt: string;
  deviceIdentifier?: string | null;
  notes?: string | null;
  isAccepted: boolean;
}

export interface StocktakeLine {
  id: string;
  stocktakeId: string;
  productId: string;
  productName?: string;
  productSku?: string;
  productBarcode?: string;
  variantId?: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
  systemQuantityScaled: number | null; // Null when blind counting for counter roles
  countedQuantityScaled: number | null;
  differenceQuantityScaled: number | null; // Null when blind counting for counter roles
  unitId: string;
  unitName?: string;
  unitPrecision: number;
  unitCostMinor?: number | null;
  differenceValueMinor?: number | null;
  countStatus: StocktakeLineStatus;
  countedBy?: string | null;
  countedAt?: string | null;
  cutoffMovementsQtyScaled: number;
  expectedQuantityScaled: number | null; // SnapshotStock + cutoffMovements
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  countEntries?: StocktakeCountEntry[];
}

export interface Stocktake {
  id: string;
  businessId: string;
  branchId: string;
  stocktakeNumber: string;
  stockLocationId: string;
  locationName?: string;
  countMode: StocktakeCountMode;
  countingMode: StocktakeCountingMode;
  status: StocktakeStatus;
  freezeStock: boolean;
  scopeCategoryId?: string | null;
  scopeCategoryName?: string | null;
  scopeConfigJson?: string | null;
  snapshotAt?: string | null;
  startedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  createdBy: string;
  creatorName?: string;
  approvedBy?: string | null;
  approverName?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  totalLinesCount?: number;
  countedLinesCount?: number;
  discrepancyLinesCount?: number;
  lines?: StocktakeLine[];
}

export interface StocktakePolicy {
  id: string;
  businessId: string;
  autoRecountQtyThresholdScaled: number;
  autoRecountValueThresholdMinor: number;
  allowBlindCounting: boolean;
  defaultCountingMode: StocktakeCountingMode;
  allowEmergencyFreezeOverride: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStocktakeDto {
  businessId?: string;
  branchId?: string;
  stockLocationId: string;
  countMode: StocktakeCountMode;
  countingMode?: StocktakeCountingMode;
  freezeStock?: boolean;
  scopeCategoryId?: string | null;
  selectedProductIds?: string[];
  notes?: string | null;
}

export interface RecordStocktakeCountDto {
  stocktakeId: string;
  productId?: string;
  productBarcode?: string; // Quick barcode scan entry
  variantId?: string | null;
  batchId?: string | null;
  countedQuantityScaled?: number;
  incrementalScanQuantityScaled?: number; // E.g. +1000 for each individual scan
  deviceIdentifier?: string | null;
  notes?: string | null;
  countSequence?: number; // Defaults to next sequence (1 for initial, 2 for recount)
}

export interface ResolveStocktakeLineDto {
  stocktakeId: string;
  lineId: string;
  action: DiscrepancyResolutionAction;
  acceptedCountSequence?: number;
  supervisorQuantityScaled?: number;
  notes?: string;
}

export interface StocktakeSummaryReport {
  stocktake: Stocktake;
  metrics: {
    totalScopedItems: number;
    totalCountedItems: number;
    totalUncountedItems: number;
    exactMatchItems: number;
    surplusItemsCount: number;
    deficitItemsCount: number;
    disputedItemsCount: number;
    abandonedItemsCount: number;
    totalSurplusQuantityScaled: number;
    totalDeficitQuantityScaled: number;
    netQuantityVarianceScaled: number;
    totalSurplusValueMinor: number;
    totalDeficitValueMinor: number;
    netMonetaryVarianceMinor: number;
    absoluteMonetaryVarianceMinor: number;
    discrepancyRatePercentage: number;
  };
  policyApplied: {
    countingMode: StocktakeCountingMode;
    freezeStock: boolean;
    autoRecountQtyThresholdScaled: number;
    autoRecountValueThresholdMinor: number;
  };
  lines: StocktakeLine[];
}

export interface StocktakeFilter {
  businessId: string;
  branchId?: string;
  stockLocationId?: string;
  status?: StocktakeStatus;
  countingMode?: StocktakeCountingMode;
  countMode?: StocktakeCountMode;
  page?: number;
  limit?: number;
}

