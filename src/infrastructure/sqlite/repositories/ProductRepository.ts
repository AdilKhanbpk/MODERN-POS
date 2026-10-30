import Database from 'better-sqlite3';
import crypto from 'crypto';
import { getDatabase } from '../connection';
import {
  Product,
  ProductVariant,
  ProductBarcode,
  ProductUnitConversion,
  ProductBatch,
  ProductSerialNumber,
  Brand,
  Unit
} from '../../../shared/types';
import { StockMovementType } from '../../../shared/constants/accounts';
import { IProductRepository } from '../../../shared/interfaces/repositories/IProductRepository';

export class ProductRepository implements IProductRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public list(): Product[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.name, p.sku, p.barcode,
             p.base_unit_id as baseUnitId, u.name as baseUnit,
             p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.default_cost_minor as defaultCostMinor, p.default_sale_price_minor as defaultSalePriceMinor,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.reorder_level_scaled as reorderLevelScaled, p.tracking_mode as trackingMode,
             p.tax_rate as taxRate, p.is_tax_inclusive as isTaxInclusive,
             p.is_active as isActive, p.allow_negative_stock as allowNegativeStock, p.created_at as createdAt
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE p.is_active = 1
      ORDER BY p.name ASC
    `).all() as any[];

    return rows.map(r => ({
      ...r,
      baseUnit: r.baseUnit || 'Piece',
      isTaxInclusive: Boolean(r.isTaxInclusive),
      isActive: Boolean(r.isActive)
    }));
  }

  public findById(id: number | string): Product | null {
    const row = this.db.prepare(`
      SELECT p.id, p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.name, p.sku, p.barcode,
             p.base_unit_id as baseUnitId, u.name as baseUnit,
             p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.default_cost_minor as defaultCostMinor, p.default_sale_price_minor as defaultSalePriceMinor,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.reorder_level_scaled as reorderLevelScaled, p.tracking_mode as trackingMode,
             p.tax_rate as taxRate, p.is_tax_inclusive as isTaxInclusive,
             p.is_active as isActive, p.allow_negative_stock as allowNegativeStock, p.created_at as createdAt
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE p.id = ?
    `).get(id) as any;

    if (!row) return null;

    const barcodes = this.getProductBarcodes(id);
    const variants = this.getProductVariants(id);
    const conversions = this.getProductUnitConversions(id);

    return {
      ...row,
      baseUnit: row.baseUnit || 'Piece',
      isTaxInclusive: Boolean(row.isTaxInclusive),
      isActive: Boolean(row.isActive),
      barcodes,
      variants,
      conversions
    };
  }

  public findByBarcode(barcode: string): Product | null {
    // 1. Direct match on products.barcode or products.sku
    const row = this.db.prepare(`
      SELECT p.id
      FROM products p
      WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1
    `).get(barcode, barcode) as { id: number } | undefined;

    if (row) {
      return this.findById(row.id);
    }

    // 2. Match in product_barcodes (multi-barcode per product/variant/unit)
    const barcodeRow = this.db.prepare(`
      SELECT product_id as productId FROM product_barcodes WHERE barcode = ?
    `).get(barcode) as { productId: number } | undefined;

    if (barcodeRow) {
      return this.findById(barcodeRow.productId);
    }

    return null;
  }

  public search(query: string): Product[] {
    const term = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT p.id, p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.name, p.sku, p.barcode,
             p.base_unit_id as baseUnitId, u.name as baseUnit,
             p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.tax_rate as taxRate, p.is_tax_inclusive as isTaxInclusive,
             p.is_active as isActive, p.allow_negative_stock as allowNegativeStock, p.created_at as createdAt
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?) AND p.is_active = 1
      ORDER BY p.name ASC
      LIMIT 50
    `).all(term, term, term) as any[];

    return rows.map(r => ({
      ...r,
      baseUnit: r.baseUnit || 'Piece',
      isTaxInclusive: Boolean(r.isTaxInclusive),
      isActive: Boolean(r.isActive)
    }));
  }

  private getNextNumericId(): number {
    const row = this.db.prepare("SELECT MAX(CAST(id AS INTEGER)) as maxId FROM products WHERE CAST(id AS INTEGER) > 0").get() as { maxId: number | null };
    return (row?.maxId || 0) + 1;
  }

  public create(product: Partial<Product>): any {
    const defaultCost = product.defaultCostMinor || product.costPrice || 0;
    const defaultPrice = product.defaultSalePriceMinor || product.sellingPrice || 0;
    const reorder = product.reorderLevelScaled || product.minStockLevel || 5;
    const baseUnitId = product.baseUnitId || 1;
    const businessId = (product as any).businessId || '00000000-0000-0000-0000-000000000001';

    const isLegacyNumeric = typeof (product as any).categoryId === 'number' && !(product as any).businessId && product.id === undefined;
    const productId = product.id !== undefined ? product.id : (isLegacyNumeric ? this.getNextNumericId() : crypto.randomUUID());

    this.db.prepare(`
      INSERT INTO products (
        id, business_id, category_id, brand_id, name, sku, barcode, base_unit, base_unit_id,
        cost_price, selling_price, default_cost_minor, default_sale_price_minor,
        current_stock, min_stock_level, reorder_level_scaled, tracking_mode,
        tax_rate, is_tax_inclusive, is_active, allow_negative_stock
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      businessId,
      product.categoryId || 1,
      product.brandId || null,
      product.name,
      product.sku,
      product.barcode,
      product.baseUnit || 'Piece',
      baseUnitId,
      defaultCost,
      defaultPrice,
      defaultCost,
      defaultPrice,
      product.currentStock || 0,
      reorder,
      reorder,
      product.trackingMode || 'STANDARD',
      product.taxRate || 0,
      product.isTaxInclusive ? 1 : 0,
      product.isActive !== false ? 1 : 0,
      (product as any).allowNegativeStock || (product as any).allow_negative_stock ? 1 : 0
    );

    // Initial stock balance projection
    try {
      const cols = this.db.prepare("PRAGMA table_info('stock_balances')").all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'stock_location_id')) {
        const defaultLoc = this.db
          .prepare(
            'SELECT id, business_id FROM stock_locations WHERE is_default = 1 AND is_active = 1 LIMIT 1'
          )
          .get() as { id: string; business_id: string } | undefined;
        if (defaultLoc) {
          const scaled = Math.round((product.currentStock || 0) * 1000);
          this.db
            .prepare(
              `INSERT OR REPLACE INTO stock_balances (
                id, business_id, product_id, variant_id, stock_location_id,
                on_hand_scaled, reserved_scaled, available_scaled
              ) VALUES (?, ?, ?, NULL, ?, ?, 0, ?)`
            )
            .run(
              `bal-${productId}-${defaultLoc.id}`,
              defaultLoc.business_id,
              String(productId),
              defaultLoc.id,
              scaled,
              scaled
            );
        }
      } else if (cols.some((c) => c.name === 'location_id')) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO stock_balances (product_id, variant_id, location_id, batch_id, quantity_base_scaled)
             VALUES (?, 0, 1, 0, ?)`
          )
          .run(productId, product.currentStock || 0);
      }
    } catch {
      // Ignore if table not present
    }

    return productId;
  }

  public update(product: Product): void {
    const cost = product.defaultCostMinor || product.costPrice || 0;
    const price = product.defaultSalePriceMinor || product.sellingPrice || 0;
    const reorder = product.reorderLevelScaled || product.minStockLevel || 5;

    this.db.prepare(`
      UPDATE products
      SET category_id = ?, brand_id = ?, name = ?, sku = ?, barcode = ?,
          cost_price = ?, selling_price = ?, default_cost_minor = ?, default_sale_price_minor = ?,
          min_stock_level = ?, reorder_level_scaled = ?,
          tax_rate = ?, is_tax_inclusive = ?, is_active = ?
      WHERE id = ?
    `).run(
      product.categoryId,
      product.brandId || null,
      product.name,
      product.sku,
      product.barcode,
      cost,
      price,
      cost,
      price,
      reorder,
      reorder,
      product.taxRate,
      product.isTaxInclusive ? 1 : 0,
      product.isActive ? 1 : 0,
      product.id
    );
  }

  public delete(id: number | string): void {
    this.db.prepare(`
      UPDATE products SET is_active = 0 WHERE id = ?
    `).run(id);
  }

  public updateStock(productId: number | string, newStock: number): void {
    this.db.prepare(`
      UPDATE products SET current_stock = ? WHERE id = ?
    `).run(newStock, productId);
  }

  public logStockMovement(movement: {
    productId: number;
    movementType: StockMovementType | string;
    quantity: number;
    previousStock: number;
    newStock: number;
    referenceType?: string;
    referenceId?: number;
    reason?: string;
    userId?: number;
    locationId?: number;
    stockLocationId?: string;
    variantId?: number;
    batchId?: number;
    serialId?: number;
  }): void {
    const locId = movement.locationId || 1;
    const stockLocId = movement.stockLocationId || null;
    const direction = (movement.newStock < movement.previousStock || movement.movementType === 'SALE' || movement.movementType === 'ADJUSTMENT_DECREASE' || movement.movementType === 'DAMAGE_WRITEOFF' || movement.quantity < 0) ? 'OUT' : 'IN';
    const qtyScaled = Math.max(1, Math.round(Math.abs(movement.quantity) * 1000));

    this.db.prepare(`
      INSERT INTO stock_movements (
        product_id, variant_id, location_id, stock_location_id, batch_id, serial_id,
        movement_type, direction, quantity, quantity_scaled, quantity_base_scaled,
        previous_stock, new_stock, reference_type, reference_id,
        source_type, source_id, reason, user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      movement.productId,
      movement.variantId || null,
      locId,
      stockLocId,
      movement.batchId || null,
      movement.serialId || null,
      movement.movementType,
      direction,
      movement.quantity,
      qtyScaled,
      movement.quantity,
      movement.previousStock,
      movement.newStock,
      movement.referenceType || 'MANUAL',
      String(movement.referenceId || '0'),
      movement.referenceType || 'MANUAL',
      movement.referenceId || 0,
      movement.reason || null,
      movement.userId || null
    );

    // Atomically maintain legacy stock_balances projection table if table structure matches
    try {
      const cols = this.db.prepare("PRAGMA table_info('stock_balances')").all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'location_id')) {
        this.db.prepare(`
          INSERT INTO stock_balances (product_id, variant_id, location_id, batch_id, quantity_base_scaled)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(product_id, variant_id, location_id, batch_id) DO UPDATE SET
            quantity_base_scaled = ?
        `).run(
          movement.productId,
          movement.variantId || 0,
          locId,
          movement.batchId || 0,
          movement.newStock,
          movement.newStock
        );
      }
    } catch {}
  }

  // --- Multi-Barcode & Packaging Unit Conversions ---

  public addBarcode(productId: number, barcode: string, unitId: number, variantId?: number): void {
    this.db.prepare(`
      INSERT INTO product_barcodes (product_id, variant_id, barcode, barcode_value, unit_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(productId, variantId || null, barcode, barcode, unitId);
  }

  public getProductBarcodes(productId: number | string): ProductBarcode[] {
    return this.db.prepare(`
      SELECT id, product_id as productId, variant_id as variantId, barcode, unit_id as unitId
      FROM product_barcodes
      WHERE product_id = ?
    `).all(productId) as ProductBarcode[];
  }

  public setUnitConversion(productId: number | string, unitId: number | string, numerator: number, denominator = 1): void {
    this.db.prepare(`
      INSERT INTO product_unit_conversions (
        product_id, unit_id, from_unit_id,
        base_units_numerator, base_units_denominator,
        to_base_factor_numerator, to_base_factor_denominator
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id, unit_id) DO UPDATE SET
        base_units_numerator = excluded.base_units_numerator,
        base_units_denominator = excluded.base_units_denominator,
        to_base_factor_numerator = excluded.to_base_factor_numerator,
        to_base_factor_denominator = excluded.to_base_factor_denominator,
        from_unit_id = excluded.from_unit_id
    `).run(productId, unitId, unitId, numerator, denominator, numerator, denominator);
  }

  public getProductUnitConversions(productId: number | string): ProductUnitConversion[] {
    return this.db.prepare(`
      SELECT c.id, c.product_id as productId, c.unit_id as unitId, u.name as unitName,
             c.base_units_numerator as baseUnitsNumerator, c.base_units_denominator as baseUnitsDenominator
      FROM product_unit_conversions c
      LEFT JOIN units u ON c.unit_id = u.id
      WHERE c.product_id = ?
    `).all(productId) as ProductUnitConversion[];
  }

  public addVariant(variant: {
    productId: number | string;
    variantSku: string;
    size?: string;
    color?: string;
    model?: string;
    costMinor?: number;
    priceMinor?: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO product_variants (product_id, variant_sku, size, color, model, cost_minor, price_minor, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      variant.productId,
      variant.variantSku,
      variant.size || null,
      variant.color || null,
      variant.model || null,
      variant.costMinor || null,
      variant.priceMinor || null
    );
    return Number(info.lastInsertRowid);
  }

  public getProductVariants(productId: number | string): ProductVariant[] {
    return this.db.prepare(`
      SELECT id, product_id as productId, variant_sku as variantSku, size, color, model,
             cost_minor as costMinor, price_minor as priceMinor, is_active as isActive
      FROM product_variants
      WHERE product_id = ? AND is_active = 1
    `).all(productId) as any[];
  }

  public addBatch(batch: {
    productId: number;
    batchNumber: string;
    expiryDate?: string;
    costMinor?: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO product_batches (product_id, batch_number, expiry_date, cost_minor)
      VALUES (?, ?, ?, ?)
    `).run(batch.productId, batch.batchNumber, batch.expiryDate || null, batch.costMinor || 0);
    return Number(info.lastInsertRowid);
  }

  public addSerialNumber(productId: number, serialNumber: string, variantId?: number): number {
    const info = this.db.prepare(`
      INSERT INTO product_serial_numbers (product_id, variant_id, serial_number, status)
      VALUES (?, ?, ?, 'IN_STOCK')
    `).run(productId, variantId || null, serialNumber);
    return Number(info.lastInsertRowid);
  }

  public listLowStock(): Product[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.category_id as categoryId, c.name as categoryName,
             p.brand_id as brandId, b.name as brandName,
             p.name, p.sku, p.barcode,
             p.base_unit_id as baseUnitId, u.name as baseUnit,
             p.cost_price as costPrice, p.selling_price as sellingPrice,
             p.current_stock as currentStock, p.min_stock_level as minStockLevel,
             p.reorder_level_scaled as reorderLevelScaled, p.tax_rate as taxRate,
             p.is_tax_inclusive as isTaxInclusive, p.is_active as isActive, p.created_at as createdAt
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      WHERE p.current_stock <= p.min_stock_level AND p.is_active = 1
      ORDER BY p.current_stock ASC
    `).all() as any[];

    return rows.map(r => ({
      ...r,
      baseUnit: r.baseUnit || 'Piece',
      isTaxInclusive: Boolean(r.isTaxInclusive),
      isActive: Boolean(r.isActive)
    }));
  }

  public listCategories(): Array<{ id: number; name: string; description?: string }> {
    return this.db.prepare(`
      SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name ASC
    `).all() as any[];
  }

  public createCategory(name: string, description?: string): number {
    const info = this.db.prepare(`
      INSERT INTO categories (name, is_active) VALUES (?, 1)
    `).run(name);
    return Number(info.lastInsertRowid);
  }

  public listUnits(): Unit[] {
    return this.db.prepare(`
      SELECT id, name, symbol, dimension, precision_scale as precisionScale
      FROM units
      ORDER BY id ASC
    `).all() as Unit[];
  }
}
