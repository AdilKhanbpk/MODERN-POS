export type UnitType = 'count' | 'weight' | 'volume' | 'length' | 'area' | 'other';

export interface Unit {
  id: string | number;
  businessId: string;
  name: string;
  abbreviation: string;
  unitType: UnitType;
  decimalPrecision: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductUnitConversion {
  id: string | number;
  businessId: string;
  productId: string | number;
  fromUnitId: string | number;
  fromUnitName?: string;
  fromUnitAbbreviation?: string;
  toBaseFactorNumerator: number;
  toBaseFactorDenominator: number;
  isPurchaseUnit: boolean;
  isSaleUnit: boolean;
  isDefaultPurchaseUnit: boolean;
  isDefaultSaleUnit: boolean;
  barcode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConvertToBaseResult {
  productId: string | number;
  productName: string;
  enteredQuantity: number;
  enteredUnitId: string | number;
  enteredUnitName: string;
  baseUnitId: string | number;
  baseUnitName: string;
  conversionNumerator: number;
  conversionDenominator: number;
  normalizedBaseQuantity: number;
  normalizedBaseQuantityScaled: number;
}

export interface ConvertFromBaseResult {
  productId: string | number;
  baseQuantity: number;
  targetUnitId: string | number;
  targetUnitName: string;
  conversionNumerator: number;
  conversionDenominator: number;
  convertedQuantity: number;
  convertedQuantityScaled: number;
}

export interface PriceConversionResult {
  productId: string | number;
  fromUnitId: string | number;
  toUnitId: string | number;
  originalPriceMinor: number;
  convertedPriceMinor: number;
  roundingRemainder: number;
}

export interface SaleReturnUnitCalculation {
  productId: string | number;
  returnedQuantity: number;
  returnedUnitId: string | number;
  originalSaleUnitId: string | number;
  originalSaleUnitPriceMinor: number;
  normalizedBaseQuantityToRestock: number;
  refundAmountMinor: number;
}

export interface CreateUnitDto {
  businessId?: string;
  name: string;
  abbreviation: string;
  unitType: UnitType;
  decimalPrecision: number;
}

export interface SaveProductUnitConversionDto {
  businessId?: string;
  productId: string | number;
  fromUnitId: string | number;
  toBaseFactorNumerator: number;
  toBaseFactorDenominator?: number;
  isPurchaseUnit?: boolean;
  isSaleUnit?: boolean;
  isDefaultPurchaseUnit?: boolean;
  isDefaultSaleUnit?: boolean;
  barcode?: string;
}

