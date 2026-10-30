export type SerialStatus =
  | 'in_stock'
  | 'reserved'
  | 'sold'
  | 'returned'
  | 'under_repair'
  | 'quarantined'
  | 'written_off';

export type SerialEventType =
  | 'PURCHASE_RECEIPT'
  | 'SALE'
  | 'SALE_RETURN'
  | 'TRANSFER'
  | 'STATUS_CHANGE'
  | 'WARRANTY_REGISTRATION'
  | 'WARRANTY_CLAIM'
  | 'REPAIR_START'
  | 'REPAIR_END'
  | 'REPLACEMENT_SWAP'
  | 'QUARANTINE'
  | 'RELEASE_QUARANTINE'
  | 'WRITE_OFF';

export type WarrantyStartTrigger = 'on_purchase' | 'on_delivery' | 'on_sale';

export interface SerialFormatRule {
  pattern?: string;
  prefix?: string;
  minLength?: number;
  maxLength?: number;
  validateImeiLuhn?: boolean;
}

export interface ProductSerialSettings {
  id: string;
  businessId: string;
  productId: string;
  serialTrackingRequired: boolean;
  serialFormatRule: SerialFormatRule | null;
  warrantyDefaultMonths: number | null;
  allowManualSerialEntry: boolean;
  warrantyStartTrigger: WarrantyStartTrigger;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSerialNumber {
  id: string;
  businessId: string;
  productId: string;
  serialNumber: string;
  manufacturerSerial?: string | null;
  imei1?: string | null;
  imei2?: string | null;
  purchaseDocumentLineId?: string | null;
  supplierId?: string | null;
  currentLocationId?: string | null;
  status: SerialStatus;
  unitCostMinor?: number | null;
  receivedAt?: string | null;
  soldAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerialNumberHistory {
  id: string;
  businessId: string;
  serialNumberId: string;
  eventType: SerialEventType;
  referenceType?: string | null;
  referenceId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  fromStatus?: SerialStatus | string | null;
  toStatus?: SerialStatus | string | null;
  notes?: string | null;
  performedBy?: number | string | null;
  occurredAt: string;
}

export interface SerialWarranty {
  id: string;
  businessId: string;
  serialNumberId: string;
  warrantyStartDate: string;
  warrantyEndDate: string | null;
  warrantyProvider?: string | null;
  warrantyReference?: string | null;
  warrantyTerms?: string | null;
  warrantyTrigger: WarrantyStartTrigger;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItemSerial {
  id: string;
  businessId: string;
  saleId: string;
  saleItemId: string;
  productId: string;
  serialNumberId: string;
  unitCostMinor?: number | null;
  warrantyId?: string | null;
  createdAt: string;
}

export interface ConfigureSerialSettingsInput {
  businessId: string;
  productId: string;
  serialTrackingRequired: boolean;
  serialFormatRule?: SerialFormatRule | null;
  warrantyDefaultMonths?: number | null;
  allowManualSerialEntry?: boolean;
  warrantyStartTrigger?: WarrantyStartTrigger;
}

export interface SerialItemInput {
  serialNumber: string;
  manufacturerSerial?: string;
  imei1?: string;
  imei2?: string;
  isManualEntry?: boolean;
}

export interface ReceiveSerialUnitsInput {
  businessId: string;
  productId: string;
  stockLocationId: string;
  supplierId?: string | null;
  purchaseDocumentLineId?: string | null;
  quantityScaled: number; // e.g. 5000 for 5 units
  unitCostMinor?: number;
  serials: SerialItemInput[];
  userId?: number | string;
  notes?: string;
}

export interface AllocateSerialsForSaleInput {
  businessId: string;
  productId: string;
  stockLocationId: string;
  quantityScaled: number;
  serials?: string[]; // serial numbers or serial IDs
}

export interface ReturnSerialInput {
  businessId: string;
  serialNumber: string;
  condition: 'working' | 'damaged' | 'inspection';
  destinationLocationId?: string;
  hasOriginalReceipt: boolean;
  receiptNumber?: string;
  saleId?: string;
  reason: string;
  managerApproved?: boolean;
  managerApprovedBy?: number | string;
  userId?: number | string;
}

export interface WarrantyClaimInput {
  businessId: string;
  serialNumber: string;
  issueDescription: string;
  claimType: 'repair' | 'replacement' | 'refund';
  userId?: number | string;
}

export interface ReplaceSerialInput {
  businessId: string;
  defectiveSerialNumber: string;
  replacementSerialNumber: string;
  reason: string;
  userId?: number | string;
}

export interface TransferSerialInput {
  businessId: string;
  serialNumber: string;
  fromLocationId: string;
  toLocationId: string;
  reason?: string;
  userId?: number | string;
}

export interface SerialSearchQuery {
  businessId: string;
  query?: string;
  productId?: string;
  status?: SerialStatus;
  currentLocationId?: string;
  page?: number;
  pageSize?: number;
}

export interface SerialAuditDetail {
  serial: ProductSerialNumber;
  product: {
    id: string;
    name: string;
    sku: string;
    categoryName?: string;
  };
  location?: {
    id: string;
    name: string;
    branchName?: string;
  } | null;
  supplier?: {
    id: string;
    name: string;
  } | null;
  warranty?: SerialWarranty & {
    isActive: boolean;
    daysRemaining: number;
  } | null;
  sale?: {
    saleId: string;
    invoiceNumber: string;
    saleDate: string;
    customerName?: string | null;
    customerPhone?: string | null;
  } | null;
  history: SerialNumberHistory[];
  maskedCost?: boolean;
  maskedCustomerPii?: boolean;
}

