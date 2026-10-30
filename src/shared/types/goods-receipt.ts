export type GoodsReceiptStatus =
  | 'draft'
  | 'pending_inspection'
  | 'pending_approval'
  | 'approved'
  | 'posted'
  | 'cancelled';

export type GoodsReceiptDiscrepancyType =
  | 'under_delivery'
  | 'over_delivery'
  | 'wrong_product'
  | 'wrong_packaging'
  | 'wrong_unit'
  | 'wrong_batch'
  | 'missing_serial'
  | 'duplicate_serial'
  | 'damaged_packaging'
  | 'expired_goods'
  | 'insufficient_shelf_life'
  | 'price_discrepancy'
  | 'no_po_reference'
  | 'other';

export type SerialCondition = 'accepted' | 'rejected' | 'damaged' | 'quarantined';

export interface GoodsReceiptSerial {
  id: string;
  goodsReceiptId: string;
  goodsReceiptLineId: string;
  serialNumberId?: string | null;
  serialNumber: string;
  manufacturerSerial?: string | null;
  imei1?: string | null;
  imei2?: string | null;
  condition: SerialCondition;
  notes?: string | null;
  createdAt: string;
}

export interface GoodsReceiptSerialInput {
  serialNumber: string;
  manufacturerSerial?: string | null;
  imei1?: string | null;
  imei2?: string | null;
  condition: SerialCondition;
  notes?: string | null;
}

export interface GoodsReceiptLine {
  id: string;
  goodsReceiptId: string;
  purchaseOrderLineId?: string | null;
  productId: string;
  productName?: string;
  productSku?: string;
  productBarcode?: string;
  variantId?: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
  purchaseUnitId: string;
  purchaseUnitName?: string;
  conversionNumerator: number;
  conversionDenominator: number;
  receivedQuantityScaled: number; // e.g. 100000 = 100.000 units
  acceptedQuantityScaled: number; // e.g. 94000 = 94.000 units
  rejectedQuantityScaled: number; // e.g. 3000 = 3.000 units
  damagedQuantityScaled: number;  // e.g. 3000 = 3.000 units
  baseAcceptedQuantityScaled: number;
  baseDamagedQuantityScaled: number;
  baseRejectedQuantityScaled: number;
  unitCostMinor?: number | null;
  discrepancyType?: GoodsReceiptDiscrepancyType | null;
  discrepancyReason?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  serials?: GoodsReceiptSerial[];
}

export interface GoodsReceipt {
  id: string;
  businessId: string;
  branchId: string;
  branchName?: string;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  supplierId: string;
  supplierName?: string;
  supplierCode?: string;
  receiptNumber: string;
  supplierDeliveryNote?: string | null;
  receivedAt: string;
  stockLocationId: string;
  stockLocationName?: string;
  status: GoodsReceiptStatus;
  notes?: string | null;
  receivedBy: string;
  receivedByName?: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedByName?: string | null;
  postedAt?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  lines?: GoodsReceiptLine[];
}

export interface GoodsReceiptLineInput {
  purchaseOrderLineId?: string | null;
  productId: string | number;
  variantId?: string | number | null;
  batchId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
  purchaseUnitId: string | number;
  conversionNumerator?: number;
  conversionDenominator?: number;
  receivedQuantityScaled: number;
  acceptedQuantityScaled?: number;
  rejectedQuantityScaled?: number;
  damagedQuantityScaled?: number;
  unitCostMinor?: number | null;
  discrepancyType?: GoodsReceiptDiscrepancyType | null;
  discrepancyReason?: string | null;
  notes?: string | null;
  serials?: GoodsReceiptSerialInput[];
}

export interface CreateGoodsReceiptInput {
  businessId?: string;
  branchId?: string;
  purchaseOrderId?: string | null;
  supplierId: string | number;
  receiptNumber?: string;
  supplierDeliveryNote?: string | null;
  receivedAt?: string;
  stockLocationId: string;
  status?: GoodsReceiptStatus;
  notes?: string | null;
  idempotencyKey?: string;
  lines: GoodsReceiptLineInput[];
}

export interface UpdateGoodsReceiptInput {
  supplierDeliveryNote?: string | null;
  stockLocationId?: string;
  notes?: string | null;
  lines?: GoodsReceiptLineInput[];
}

export interface InspectGoodsReceiptLineInput {
  goodsReceiptLineId: string;
  acceptedQuantityScaled: number;
  rejectedQuantityScaled: number;
  damagedQuantityScaled: number;
  discrepancyType?: GoodsReceiptDiscrepancyType | null;
  discrepancyReason?: string | null;
  notes?: string | null;
  serials?: GoodsReceiptSerialInput[];
}

export interface InspectGoodsReceiptInput {
  goodsReceiptId: string;
  notes?: string;
  lines: InspectGoodsReceiptLineInput[];
}

export interface PostGoodsReceiptInput {
  goodsReceiptId: string;
  quarantineLocationId?: string;
  managerApproved?: boolean;
  managerOverrideReason?: string;
  idempotencyKey?: string;
}

export interface GoodsReceiptSettings {
  id: string;
  businessId: string;
  allowDirectReceipt: boolean;
  requireInspection: boolean;
  quarantineLocationId?: string | null;
  damagedLocationId?: string | null;
  overDeliveryPolicy: 'reject' | 'allow_tolerance' | 'require_approval';
  overDeliveryTolerancePercent: number;
  provisionalCostPolicy: 'last_purchase_price' | 'product_cost' | 'zero' | 'require_manual';
  createdAt: string;
  updatedAt: string;
}

export interface GoodsReceiptFilterQuery {
  businessId: string;
  branchId?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  status?: GoodsReceiptStatus | GoodsReceiptStatus[];
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface GoodsReceiptDiscrepancyReportItem {
  receiptId: string;
  receiptNumber: string;
  purchaseOrderNumber?: string | null;
  supplierName: string;
  receivedAt: string;
  productId: string;
  productName: string;
  orderedQuantityScaled: number;
  receivedQuantityScaled: number;
  acceptedQuantityScaled: number;
  rejectedQuantityScaled: number;
  damagedQuantityScaled: number;
  discrepancyType: GoodsReceiptDiscrepancyType;
  discrepancyReason: string;
  unitCostMinor?: number;
  financialImpactMinor: number;
}

