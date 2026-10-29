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
  findById(id: number | string): Product | null;
  findByBarcode(barcode: string): Product | null;
  search(query: string): Product[];
  create(product: Partial<Product>): number | string;
  update(product: Product): void;
  delete(id: number | string): void;

  // Variants & conversions
  addVariant(variant: any): number | string;
  getProductVariants(productId: number | string): ProductVariant[];
  addBarcode(productId: number | string, barcode: string, unitId: number | string, variantId?: number | string): void;
  getProductBarcodes(productId: number | string): ProductBarcode[];
  setUnitConversion(productId: number | string, unitId: number | string, numerator: number, denominator?: number): void;
  getProductUnitConversions(productId: number | string): ProductUnitConversion[];
  updateStock?(id: number | string, newStock: number): void;
  logStockMovement?(movement: any): void;
}
