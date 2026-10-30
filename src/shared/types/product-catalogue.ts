export type ProductType = 'standard' | 'variant_parent' | 'variant' | 'service' | 'weighted';

export type CostMethod = 'weighted_average' | 'fifo';

export type PriceType = 'retail' | 'wholesale' | 'special' | 'minimum';

export interface ProductCategoryEntity {
  id: string;
  businessId: string;
  parentId?: string | null;
  name: string;
  code?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandEntity {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetailsEntity {
  productId: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  countryOfOrigin?: string | null;
  warrantyMonths?: number | null;
  customAttributes?: Record<string, any> | null;
}

export interface ProductPriceEntity {
  id: string;
  businessId: string;
  productId: string;
  priceType: PriceType;
  unitId: string | number;
  amountMinor: number;
  currencyCode: string;
  minimumQuantityScaled: number;
  validFrom?: string | null;
  validTo?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogueProduct {
  id: string;
  businessId: string;
  sku: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  brandId?: string | null;
  brandName?: string | null;
  productType: ProductType;
  baseUnitId: string | number;
  baseUnitName?: string;
  defaultSaleUnitId?: string | number | null;
  defaultPurchaseUnitId?: string | number | null;
  costMethod: CostMethod;
  trackStock: boolean;
  allowNegativeStock: boolean;
  isActive: boolean;
  imagePath?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;

  // Cached / shortcut fields
  barcode?: string | null;
  costPrice?: number;
  sellingPrice?: number;
  currentStock?: number;
  minStockLevel?: number;
  taxRate?: number;
  isTaxInclusive?: boolean;

  // Optional extensions
  details?: ProductDetailsEntity | null;
  prices?: ProductPriceEntity[];
}

export interface CreateProductDto {
  businessId: string;
  sku: string;
  name: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  productType?: ProductType;
  baseUnitId: string | number;
  defaultSaleUnitId?: string | number;
  defaultPurchaseUnitId?: string | number;
  costMethod?: CostMethod;
  trackStock?: boolean;
  allowNegativeStock?: boolean;
  isActive?: boolean;
  imagePath?: string;
  createdBy?: string;

  // Pricing & Stock
  barcode?: string;
  purchaseCostMinor?: number;
  costPrice?: number;
  retailPriceMinor?: number;
  wholesalePriceMinor?: number;
  openingStockScaled?: number;
  lowStockThreshold?: number;
  taxRate?: number;
  isTaxInclusive?: boolean;

  // Optional attributes
  details?: {
    manufacturer?: string;
    modelNumber?: string;
    countryOfOrigin?: string;
    warrantyMonths?: number;
    customAttributes?: Record<string, any>;
  };
}

export interface UpdateProductDto extends Partial<CreateProductDto> {
  id?: string;
}

export interface ProductSearchParams {
  businessId: string;
  query?: string;
  categoryId?: string;
  brandId?: string;
  productType?: ProductType;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface PaginatedProductsResult {
  items: CatalogueProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateProductPriceDto {
  businessId: string;
  productId: string;
  priceType: PriceType;
  unitId: string | number;
  amountMinor: number;
  currencyCode?: string;
  minimumQuantityScaled?: number;
  validFrom?: string;
  validTo?: string;
  isActive?: boolean;
}

export interface CreateCategoryDto {
  businessId: string;
  name: string;
  code?: string;
  parentId?: string;
  isActive?: boolean;
}

export interface UpdateCategoryDto {
  name?: string;
  code?: string;
  parentId?: string | null;
  isActive?: boolean;
}

export interface CreateBrandDto {
  businessId: string;
  name: string;
  isActive?: boolean;
}

