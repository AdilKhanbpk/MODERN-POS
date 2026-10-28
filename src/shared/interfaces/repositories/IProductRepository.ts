import {
  Product,
  ProductVariant,
  ProductBarcode,
  ProductUnitConversion,
  ProductPrice,
  ProductBatch,
  ProductSerialNumber
} from '../../types';

export interface IProductRepository {
  list(): Product[];
  findById(id: number): Product | null;
  findByBarcode(barcode: string): Product | null;
  search(query: string): Product[];
  create(product: Partial<Product>): number;
  update(product: Product): void;
  delete(id: number): void;

  // Variants & conversions
  addVariant(variant: Partial<ProductVariant>): number;
  getProductVariants(productId: number): ProductVariant[];
  addBarcode(productId: number, barcode: string, unitId: number, variantId?: number): void;
  getProductBarcodes(productId: number): ProductBarcode[];
  setUnitConversion(productId: number, unitId: number, numerator: number, denominator?: number): void;
  getProductUnitConversions(productId: number): ProductUnitConversion[];
}
