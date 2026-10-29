export type BarcodeType =
  | 'EAN13'
  | 'UPC'
  | 'CODE128'
  | 'CODE39'
  | 'ITF14'
  | 'GS1_128'
  | 'QR'
  | 'INTERNAL'
  | 'SCALE_WEIGHT'
  | 'SCALE_PRICE'
  | 'OTHER';

export interface ProductBarcode {
  id: string;
  businessId: string;
  productId: string | number;
  productUnitConversionId?: string | number | null;
  barcodeValue: string;
  barcodeType: BarcodeType;
  isPrimary: boolean;
  isActive: boolean;
  createdAt?: string;
  createdBy?: string | number;
  // Resolved packaging & unit metadata
  unitId?: string | number;
  unitName?: string;
  conversionNumerator?: number;
  conversionDenominator?: number;
}

export interface CreateBarcodeDto {
  businessId?: string;
  productId: string | number;
  productUnitConversionId?: string | number | null;
  barcodeValue: string;
  barcodeType?: BarcodeType;
  isPrimary?: boolean;
  isActive?: boolean;
  unitId?: string | number;
}

export interface ScaleBarcodeProfile {
  id: string;
  businessId: string;
  name: string;
  prefix: string;
  totalLength: number;
  productCodeStart: number;
  productCodeLength: number;
  valueStart: number;
  valueLength: number;
  valueType: 'weight' | 'price';
  decimalPlaces: number;
  checkDigitRule?: string | null; // e.g. 'EAN13_MOD10' or null
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateScaleProfileDto {
  businessId?: string;
  name: string;
  prefix: string;
  totalLength: number;
  productCodeStart: number;
  productCodeLength: number;
  valueStart: number;
  valueLength: number;
  valueType: 'weight' | 'price';
  decimalPlaces?: number;
  checkDigitRule?: string | null;
  isActive?: boolean;
}

export interface ParsedScaleBarcode {
  rawBarcode: string;
  profileId: string;
  profileName: string;
  prefix: string;
  productCode: string;
  valueType: 'weight' | 'price';
  rawValue: number;
  parsedValue: number;
  isValid: boolean;
  validationError?: string;
  checkDigit?: number;
  expectedCheckDigit?: number;
}

export interface BarcodeLookupResult {
  status: 'FOUND' | 'MULTIPLE_MATCHES' | 'SCALE_BARCODE' | 'NOT_FOUND';
  barcodeValue: string;
  product?: any;
  packagingUnit?: any;
  unitId?: string | number;
  unitName?: string;
  unitPriceMinor?: number;
  parsedWeight?: number;
  parsedPriceMinor?: number;
  linePriceMinor?: number;
  matches?: Array<{ product: any; unit?: any; barcode?: string }>;
  message?: string;
}

export interface ScannerConfig {
  enabled: boolean;
  prefix?: string;
  suffix: string; // 'Enter', 'Tab', etc.
  minLength: number;
  maxInterKeyTimeMs: number;
  duplicateTimeoutMs: number;
}

export interface ScaleBarcodeTestResult {
  isValid: boolean;
  rawBarcode: string;
  profileName: string;
  prefixSegment: string;
  productCodeSegment: string;
  valueSegment: string;
  valueType: 'weight' | 'price';
  parsedValue: number;
  checkDigitSegment?: string;
  expectedCheckDigit?: number;
  error?: string;
}

