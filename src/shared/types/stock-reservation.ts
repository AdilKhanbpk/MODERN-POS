/**
 * Stock Reservation Types & Contracts (Prompt 17)
 */

export type StockReservationSourceType = 'quotation' | 'sales_order' | 'manual' | 'other';

export type StockReservationStatus =
  | 'draft'
  | 'active'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'expired'
  | 'cancelled';

export interface StockReservationLine {
  id: string;
  reservationId: string;
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  batchId?: string | number | null;
  reservedQuantityScaled: number;
  fulfilledQuantityScaled: number;
  releasedQuantityScaled: number;
  unitId?: string | number | null;
  productName?: string;
  sku?: string;
  locationName?: string;
  unitName?: string;
}

export interface StockReservation {
  id: string;
  businessId: string;
  branchId: string;
  reservationNumber: string;
  customerId?: string | null;
  sourceType: StockReservationSourceType;
  sourceId?: string | null;
  status: StockReservationStatus;
  reservedAt?: string | null;
  expiresAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  branchName?: string;
  creatorName?: string;
  lines?: StockReservationLine[];
}

export interface CreateReservationLineInput {
  productId: string | number;
  variantId?: string | number | null;
  stockLocationId: string;
  batchId?: string | number | null;
  reservedQuantityScaled: number;
  unitId?: string | number | null;
}

export interface CreateReservationDto {
  businessId: string;
  branchId: string;
  customerId?: string | null;
  sourceType: StockReservationSourceType;
  sourceId?: string | null;
  expiresAt?: string | null;
  lines: CreateReservationLineInput[];
}

export interface FulfillReservationLineInput {
  lineId: string;
  fulfillQuantityScaled: number;
}

export interface FulfillReservationDto {
  reservationId: string;
  saleId?: string | null;
  lines: FulfillReservationLineInput[];
}

export interface ReleaseReservationDto {
  reservationId: string;
  reason?: string;
  lineIds?: string[];
}

export interface ExtendReservationDto {
  reservationId: string;
  newExpiresAt: string;
  authorizedBy?: string;
}

export interface ReservationFilter {
  businessId: string;
  branchId?: string;
  status?: StockReservationStatus;
  customerId?: string;
  sourceType?: StockReservationSourceType;
  search?: string;
}
