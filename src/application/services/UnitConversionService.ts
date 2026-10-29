import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  Unit,
  ProductUnitConversion,
  ConvertToBaseResult,
  ConvertFromBaseResult,
  PriceConversionResult,
  SaleReturnUnitCalculation,
  CreateUnitDto,
  SaveProductUnitConversionDto
} from '../../shared/types/unit-conversion';
import {
  QUANTITY_SCALE,
  toScaledQuantity,
  fromScaledQuantity,
  validateQuantityPrecision
} from '../../domain/units/scaled-quantity';

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitConversionError';
  }
}

export class UnsupportedConversionError extends UnitConversionError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConversionError';
  }
}

export class ForbiddenConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenConversionError';
  }
}

export interface ActorContext {
  userId: string | number;
  role: string;
  businessId?: string;
  branchId?: string;
}

export class UnitConversionService {
  constructor(private db: Database.Database) {}

  /**
   * Helper to fetch a product row with its base unit
   */
  private getProductRow(productId: string | number): {
    id: any;
    business_id: string;
    name: string;
    sku: string;
    base_unit_id: any;
    base_unit?: string;
    is_active: number;
  } {
    const row = this.db.prepare(`
      SELECT id, business_id, name, sku, base_unit_id, base_unit, is_active
      FROM products
      WHERE id = ?
    `).get(productId) as any;

    if (!row) {
      throw new UnitConversionError(`Product with id "${productId}" not found.`);
    }
    return row;
  }

  /**
   * Helper to fetch a unit row
   */
  public getUnit(unitId: string | number): Unit {
    const row = this.db.prepare(`
      SELECT id, business_id, name,
             COALESCE(abbreviation, symbol, name) as abbreviation,
             LOWER(COALESCE(unit_type, dimension, 'count')) as unit_type,
             COALESCE(decimal_precision, precision_scale, 0) as decimal_precision,
             COALESCE(is_active, 1) as is_active,
             created_at, updated_at
      FROM units
      WHERE id = ?
    `).get(unitId) as any;

    if (!row) {
      throw new UnitConversionError(`Unit with id "${unitId}" not found.`);
    }

    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      abbreviation: row.abbreviation,
      unitType: row.unit_type,
      decimalPrecision: row.decimal_precision,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Central Service: convertToBaseQuantity(productId, enteredQuantity, enteredUnitId)
   *
   * 1. Loads the product and verifies it exists.
   * 2. If enteredUnit is product's base unit, factor is 1/1.
   * 3. Otherwise loads product's configured conversion for enteredUnit.
   * 4. Verifies the unit is valid for that product (rejects unsupported/ambiguous conversions).
   * 5. Checks positive numerator and denominator.
   * 6. Checks supported quantity precision against unit's decimal precision.
   * 7. Computes exact normalized base quantity and scaled units without floating-point errors.
   */
  public convertToBaseQuantity(
    productId: string | number,
    enteredQuantity: number,
    enteredUnitId: string | number
  ): ConvertToBaseResult {
    const product = this.getProductRow(productId);
    const enteredUnit = this.getUnit(enteredUnitId);

    if (enteredQuantity < 0) {
      throw new UnitConversionError(`Quantity cannot be negative: ${enteredQuantity}`);
    }

    // Validate entered quantity precision scale for the unit
    validateQuantityPrecision(enteredQuantity, enteredUnit.decimalPrecision);

    const baseUnitId = product.base_unit_id || 1;
    const baseUnit = this.getUnit(baseUnitId);

    // Case A: Entered unit is the base unit (1:1 conversion)
    if (String(enteredUnitId) === String(baseUnitId)) {
      const scaled = toScaledQuantity(enteredQuantity, baseUnit.decimalPrecision);
      return {
        productId: product.id,
        productName: product.name,
        enteredQuantity,
        enteredUnitId: enteredUnit.id,
        enteredUnitName: enteredUnit.name,
        baseUnitId: baseUnit.id,
        baseUnitName: baseUnit.name,
        conversionNumerator: 1,
        conversionDenominator: 1,
        normalizedBaseQuantity: enteredQuantity,
        normalizedBaseQuantityScaled: scaled
      };
    }

    // Case B: Look up product-specific conversion rule
    const convRow = this.db.prepare(`
      SELECT id, business_id, product_id,
             COALESCE(from_unit_id, unit_id) as from_unit_id,
             COALESCE(to_base_factor_numerator, base_units_numerator) as numerator,
             COALESCE(to_base_factor_denominator, base_units_denominator, 1) as denominator
      FROM product_unit_conversions
      WHERE product_id = ? AND (from_unit_id = ? OR unit_id = ?)
    `).get(productId, enteredUnitId, enteredUnitId) as any;

    if (!convRow) {
      throw new UnsupportedConversionError(
        `Unit "${enteredUnit.name}" (${enteredUnit.abbreviation}) is not configured for product "${product.name}". Unsupported conversion.`
      );
    }

    const numerator = Number(convRow.numerator);
    const denominator = Number(convRow.denominator);

    if (!Number.isInteger(numerator) || numerator <= 0) {
      throw new UnitConversionError(`Conversion numerator must be a positive integer. Received: ${numerator}`);
    }
    if (!Number.isInteger(denominator) || denominator <= 0) {
      throw new UnitConversionError(`Conversion denominator must be a positive integer. Received: ${denominator}`);
    }

    // Exact rational scaling
    const enteredScaled = toScaledQuantity(enteredQuantity, enteredUnit.decimalPrecision);
    const multipliedScaled = enteredScaled * numerator;
    const remainder = multipliedScaled % denominator;

    if (remainder !== 0) {
      throw new UnitConversionError(
        `Converting ${enteredQuantity} ${enteredUnit.name} with factor (${numerator}/${denominator}) ` +
        `yields an unrepresentable remainder of ${remainder}/${denominator} scaled units. Exact representation is required.`
      );
    }

    const baseQuantityScaled = multipliedScaled / denominator;
    const normalizedBaseQuantity = fromScaledQuantity(baseQuantityScaled);

    return {
      productId: product.id,
      productName: product.name,
      enteredQuantity,
      enteredUnitId: enteredUnit.id,
      enteredUnitName: enteredUnit.name,
      baseUnitId: baseUnit.id,
      baseUnitName: baseUnit.name,
      conversionNumerator: numerator,
      conversionDenominator: denominator,
      normalizedBaseQuantity,
      normalizedBaseQuantityScaled: baseQuantityScaled
    };
  }

  /**
   * Central Service: convertFromBaseQuantity(productId, baseQuantity, targetUnitId)
   * Converts a canonical base quantity back into target packaging/display units.
   */
  public convertFromBaseQuantity(
    productId: string | number,
    baseQuantity: number,
    targetUnitId: string | number
  ): ConvertFromBaseResult {
    const product = this.getProductRow(productId);
    const targetUnit = this.getUnit(targetUnitId);
    const baseUnitId = product.base_unit_id || 1;

    if (baseQuantity < 0) {
      throw new UnitConversionError(`Base quantity cannot be negative: ${baseQuantity}`);
    }

    // Case A: Target unit is base unit
    if (String(targetUnitId) === String(baseUnitId)) {
      const scaled = toScaledQuantity(baseQuantity, targetUnit.decimalPrecision);
      return {
        productId: product.id,
        baseQuantity,
        targetUnitId: targetUnit.id,
        targetUnitName: targetUnit.name,
        conversionNumerator: 1,
        conversionDenominator: 1,
        convertedQuantity: baseQuantity,
        convertedQuantityScaled: scaled
      };
    }

    // Case B: Look up product-specific conversion rule
    const convRow = this.db.prepare(`
      SELECT id,
             COALESCE(from_unit_id, unit_id) as from_unit_id,
             COALESCE(to_base_factor_numerator, base_units_numerator) as numerator,
             COALESCE(to_base_factor_denominator, base_units_denominator, 1) as denominator
      FROM product_unit_conversions
      WHERE product_id = ? AND (from_unit_id = ? OR unit_id = ?)
    `).get(productId, targetUnitId, targetUnitId) as any;

    if (!convRow) {
      throw new UnsupportedConversionError(
        `Unit "${targetUnit.name}" is not configured for product "${product.name}". Unsupported conversion.`
      );
    }

    const numerator = Number(convRow.numerator);
    const denominator = Number(convRow.denominator);

    if (numerator <= 0 || denominator <= 0) {
      throw new UnitConversionError('Conversion factors must be positive integers.');
    }

    const baseScaled = toScaledQuantity(baseQuantity);
    // Reverse factor: multiply by denominator, divide by numerator
    const multiplied = baseScaled * denominator;
    const remainder = multiplied % numerator;

    if (remainder !== 0) {
      throw new UnitConversionError(
        `Converting base quantity ${baseQuantity} to ${targetUnit.name} with ratio (${numerator}/${denominator}) ` +
        `yields an unrepresentable fraction. Exact representation required.`
      );
    }

    const convertedScaled = multiplied / numerator;
    const convertedQuantity = fromScaledQuantity(convertedScaled);

    validateQuantityPrecision(convertedQuantity, targetUnit.decimalPrecision);

    return {
      productId: product.id,
      baseQuantity,
      targetUnitId: targetUnit.id,
      targetUnitName: targetUnit.name,
      conversionNumerator: numerator,
      conversionDenominator: denominator,
      convertedQuantity,
      convertedQuantityScaled: convertedScaled
    };
  }

  /**
   * Price Conversion:
   * Converts unit price from one unit to another via exact rational calculation.
   * E.g., 1 Carton contains 24 Pieces. Carton sale price = 2,400 minor units.
   * Equivalent Piece price = (2400 * 1) / 24 = 100 minor units.
   */
  public convertUnitPrice(
    productId: string | number,
    fromUnitId: string | number,
    toUnitId: string | number,
    priceMinor: number,
    roundingMode: 'HALF_UP' | 'EXACT' = 'HALF_UP'
  ): PriceConversionResult {
    if (priceMinor < 0) {
      throw new UnitConversionError(`Price cannot be negative: ${priceMinor}`);
    }

    if (String(fromUnitId) === String(toUnitId)) {
      return {
        productId,
        fromUnitId,
        toUnitId,
        originalPriceMinor: priceMinor,
        convertedPriceMinor: priceMinor,
        roundingRemainder: 0
      };
    }

    const product = this.getProductRow(productId);
    const baseUnitId = product.base_unit_id || 1;

    // Get fromUnit factor to base: 1 fromUnit = numFrom / denFrom base units
    let numFrom = 1;
    let denFrom = 1;
    if (String(fromUnitId) !== String(baseUnitId)) {
      const convFrom = this.db.prepare(`
        SELECT COALESCE(to_base_factor_numerator, base_units_numerator) as num,
               COALESCE(to_base_factor_denominator, base_units_denominator, 1) as den
        FROM product_unit_conversions
        WHERE product_id = ? AND (from_unit_id = ? OR unit_id = ?)
      `).get(productId, fromUnitId, fromUnitId) as any;
      if (!convFrom) {
        throw new UnsupportedConversionError(`From-unit "${fromUnitId}" not configured for product "${productId}".`);
      }
      numFrom = Number(convFrom.num);
      denFrom = Number(convFrom.den);
    }

    // Get toUnit factor to base: 1 toUnit = numTo / denTo base units
    let numTo = 1;
    let denTo = 1;
    if (String(toUnitId) !== String(baseUnitId)) {
      const convTo = this.db.prepare(`
        SELECT COALESCE(to_base_factor_numerator, base_units_numerator) as num,
               COALESCE(to_base_factor_denominator, base_units_denominator, 1) as den
        FROM product_unit_conversions
        WHERE product_id = ? AND (from_unit_id = ? OR unit_id = ?)
      `).get(productId, toUnitId, toUnitId) as any;
      if (!convTo) {
        throw new UnsupportedConversionError(`To-unit "${toUnitId}" not configured for product "${productId}".`);
      }
      numTo = Number(convTo.num);
      denTo = Number(convTo.den);
    }

    // Target Price = (priceMinor * denFrom * numTo) / (numFrom * denTo)
    const numerator = priceMinor * denFrom * numTo;
    const denominator = numFrom * denTo;

    const remainder = numerator % denominator;
    let convertedPriceMinor: number;

    if (roundingMode === 'EXACT') {
      if (remainder !== 0) {
        throw new UnitConversionError(
          `Price ${priceMinor} cannot be divided exactly by factor ratio ${denominator}/${numerator}. Remainder: ${remainder}.`
        );
      }
      convertedPriceMinor = numerator / denominator;
    } else {
      convertedPriceMinor = Math.round(numerator / denominator);
    }

    return {
      productId,
      fromUnitId,
      toUnitId,
      originalPriceMinor: priceMinor,
      convertedPriceMinor,
      roundingRemainder: remainder
    };
  }

  /**
   * Return in a different unit from original sale:
   * Example: Sold 1 Carton of 24 pieces for Rs. 2,400.
   * Customer returns 6 pieces.
   * Equivalent piece price = 2,400 / 24 = 100 minor units.
   * Refund = 6 * 100 = 600 minor units (Rs. 6.00).
   * Restock = 6 Pieces.
   */
  public calculateSaleReturn(params: {
    productId: string | number;
    originalSaleUnitId: string | number;
    originalSaleUnitPriceMinor: number;
    returnUnitId: string | number;
    returnQuantity: number;
  }): SaleReturnUnitCalculation {
    const { productId, originalSaleUnitId, originalSaleUnitPriceMinor, returnUnitId, returnQuantity } = params;

    // 1. Calculate how many base units to restock
    const baseRestock = this.convertToBaseQuantity(productId, returnQuantity, returnUnitId);

    // 2. Convert original unit price to the return unit price
    const priceConv = this.convertUnitPrice(
      productId,
      originalSaleUnitId,
      returnUnitId,
      originalSaleUnitPriceMinor,
      'HALF_UP'
    );

    const refundAmountMinor = Math.round(returnQuantity * priceConv.convertedPriceMinor);

    return {
      productId,
      returnedQuantity: returnQuantity,
      returnedUnitId: returnUnitId,
      originalSaleUnitId,
      originalSaleUnitPriceMinor,
      normalizedBaseQuantityToRestock: baseRestock.normalizedBaseQuantity,
      refundAmountMinor
    };
  }

  /**
   * Save Product Unit Conversion:
   * Permission-guarded: Only authorized roles (Owner, Administrator, Manager) can edit.
   * Cashiers are strictly rejected.
   * Audit event is recorded immutably.
   */
  public saveProductUnitConversion(
    dto: SaveProductUnitConversionDto,
    actor: ActorContext
  ): ProductUnitConversion {
    // Permission check
    const role = (actor.role || '').toLowerCase();
    if (role === 'cashier' || role === 'clerk') {
      throw new ForbiddenConversionError('You do not have permission to modify unit conversions.');
    }

    const numerator = Math.floor(Number(dto.toBaseFactorNumerator));
    const denominator = Math.floor(Number(dto.toBaseFactorDenominator || 1));

    if (isNaN(numerator) || numerator <= 0) {
      throw new UnitConversionError(`Conversion numerator must be a positive integer greater than zero. Received: ${dto.toBaseFactorNumerator}`);
    }
    if (isNaN(denominator) || denominator <= 0) {
      throw new UnitConversionError(`Conversion denominator must be a positive integer greater than zero. Received: ${dto.toBaseFactorDenominator}`);
    }

    const product = this.getProductRow(dto.productId);
    const unit = this.getUnit(dto.fromUnitId);

    const businessId = dto.businessId || product.business_id || actor.businessId || '00000000-0000-0000-0000-000000000001';
    const convId = randomUUID();

    const existing = this.db.prepare(`
      SELECT id,
             COALESCE(to_base_factor_numerator, base_units_numerator) as num,
             COALESCE(to_base_factor_denominator, base_units_denominator, 1) as den
      FROM product_unit_conversions
      WHERE product_id = ? AND (from_unit_id = ? OR unit_id = ?)
    `).get(dto.productId, dto.fromUnitId, dto.fromUnitId) as any;

    const isPurchase = dto.isPurchaseUnit !== undefined ? (dto.isPurchaseUnit ? 1 : 0) : 1;
    const isSale = dto.isSaleUnit !== undefined ? (dto.isSaleUnit ? 1 : 0) : 1;
    const isDefPurchase = dto.isDefaultPurchaseUnit ? 1 : 0;
    const isDefSale = dto.isDefaultSaleUnit ? 1 : 0;

    let resultId = convId;

    if (existing) {
      resultId = existing.id;
      this.db.prepare(`
        UPDATE product_unit_conversions
        SET
          to_base_factor_numerator = ?,
          to_base_factor_denominator = ?,
          base_units_numerator = ?,
          base_units_denominator = ?,
          is_purchase_unit = ?,
          is_sale_unit = ?,
          is_default_purchase_unit = ?,
          is_default_sale_unit = ?,
          barcode = ?,
          updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
        WHERE id = ?
      `).run(
        numerator,
        denominator,
        numerator,
        denominator,
        isPurchase,
        isSale,
        isDefPurchase,
        isDefSale,
        dto.barcode || null,
        existing.id
      );

      this.logAudit({
        businessId,
        actor,
        action: 'UNIT_CONVERSION_UPDATED',
        entityType: 'product_unit_conversion',
        entityId: String(existing.id),
        details: JSON.stringify({
          productId: dto.productId,
          productName: product.name,
          unitId: dto.fromUnitId,
          unitName: unit.name,
          oldFactor: `${existing.num}/${existing.den}`,
          newFactor: `${numerator}/${denominator}`
        })
      });
    } else {
      this.db.prepare(`
        INSERT INTO product_unit_conversions (
          id, business_id, product_id, from_unit_id, unit_id,
          to_base_factor_numerator, to_base_factor_denominator,
          base_units_numerator, base_units_denominator,
          is_purchase_unit, is_sale_unit, is_default_purchase_unit, is_default_sale_unit,
          barcode
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        convId,
        businessId,
        dto.productId,
        dto.fromUnitId,
        dto.fromUnitId,
        numerator,
        denominator,
        numerator,
        denominator,
        isPurchase,
        isSale,
        isDefPurchase,
        isDefSale,
        dto.barcode || null
      );

      this.logAudit({
        businessId,
        actor,
        action: 'UNIT_CONVERSION_CREATED',
        entityType: 'product_unit_conversion',
        entityId: convId,
        details: JSON.stringify({
          productId: dto.productId,
          productName: product.name,
          unitId: dto.fromUnitId,
          unitName: unit.name,
          factor: `${numerator}/${denominator}`
        })
      });
    }

    return {
      id: resultId,
      businessId,
      productId: dto.productId,
      fromUnitId: dto.fromUnitId,
      fromUnitName: unit.name,
      fromUnitAbbreviation: unit.abbreviation,
      toBaseFactorNumerator: numerator,
      toBaseFactorDenominator: denominator,
      isPurchaseUnit: Boolean(isPurchase),
      isSaleUnit: Boolean(isSale),
      isDefaultPurchaseUnit: Boolean(isDefPurchase),
      isDefaultSaleUnit: Boolean(isDefSale),
      barcode: dto.barcode
    };
  }

  /**
   * Helper to write immutable audit logs safely across schema versions
   */
  private logAudit(entry: {
    businessId: string;
    actor: ActorContext;
    action: string;
    entityType: string;
    entityId: string;
    details: string;
  }): void {
    try {
      const auditCols = this.db.prepare("PRAGMA table_info(audit_logs)").all() as Array<{ name: string }>;
      const hasBusinessId = auditCols.some((c) => c.name === 'business_id');

      let validUserId: string | null = null;
      if (entry.actor.userId) {
        const u = this.db.prepare('SELECT id FROM users WHERE id = ?').get(String(entry.actor.userId));
        if (u) {
          validUserId = String(entry.actor.userId);
        }
      }

      if (hasBusinessId) {
        this.db.prepare(`
          INSERT INTO audit_logs (
            id, business_id, branch_id, user_id, action, entity_type, entity_id, after_data, ip_address
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          entry.businessId,
          entry.actor.branchId || null,
          validUserId,
          entry.action,
          entry.entityType,
          entry.entityId,
          entry.details,
          '127.0.0.1'
        );
      } else {
        this.db.prepare(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          validUserId ? Number(validUserId) : null,
          entry.action,
          entry.entityType,
          Number(entry.entityId) || 1,
          entry.details
        );
      }
    } catch (err) {
      console.warn('Audit log write warning:', err);
    }
  }

  /**
   * Post document line snapshot (for historical immutability):
   * Stores entered quantity, unit, exact rational factors, base quantity, and prices.
   */
  public recordDocumentLineSnapshot(params: {
    documentType: 'SALE' | 'PURCHASE';
    documentId: number | string;
    productId: number | string;
    enteredQuantity: number;
    enteredUnitId: number | string;
    unitPriceMinor: number;
  }): {
    lineId: number | string;
    conversionNumerator: number;
    conversionDenominator: number;
    normalizedBaseQuantity: number;
    baseUnitPriceMinor: number;
  } {
    const baseConversion = this.convertToBaseQuantity(
      params.productId,
      params.enteredQuantity,
      params.enteredUnitId
    );

    const priceConversion = this.convertUnitPrice(
      params.productId,
      params.enteredUnitId,
      baseConversion.baseUnitId,
      params.unitPriceMinor,
      'HALF_UP'
    );

    const product = this.getProductRow(params.productId);
    const unit = this.getUnit(params.enteredUnitId);

    if (params.documentType === 'SALE') {
      const saleExists = this.db.prepare('SELECT id FROM sales WHERE id = ?').get(params.documentId);
      if (!saleExists) {
        this.db.prepare(`
          INSERT OR IGNORE INTO sales (id, invoice_number, cashier_id, subtotal, grand_total, payment_method)
          VALUES (?, ?, 1, 0, 0, 'CASH')
        `).run(params.documentId, `INV-${params.documentId}`);
      }

      const info = this.db.prepare(`
        INSERT INTO sale_lines (
          sale_id, product_id, product_name_snapshot, sku_snapshot,
          unit_id, quantity_scaled, unit_price_minor, line_total_minor,
          entered_quantity, entered_unit_id,
          conversion_numerator, conversion_denominator,
          base_quantity_scaled, base_unit_price_minor,
          unit_name_snapshot, conversion_numerator_snapshot, conversion_denominator_snapshot
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.documentId,
        params.productId,
        product.name,
        product.sku,
        params.enteredUnitId,
        baseConversion.normalizedBaseQuantityScaled,
        params.unitPriceMinor,
        Math.round(params.enteredQuantity * params.unitPriceMinor),
        params.enteredQuantity,
        params.enteredUnitId,
        baseConversion.conversionNumerator,
        baseConversion.conversionDenominator,
        baseConversion.normalizedBaseQuantityScaled,
        priceConversion.convertedPriceMinor,
        unit.name,
        baseConversion.conversionNumerator,
        baseConversion.conversionDenominator
      );

      return {
        lineId: Number(info.lastInsertRowid),
        conversionNumerator: baseConversion.conversionNumerator,
        conversionDenominator: baseConversion.conversionDenominator,
        normalizedBaseQuantity: baseConversion.normalizedBaseQuantity,
        baseUnitPriceMinor: priceConversion.convertedPriceMinor
      };
    } else {
      const purchaseExists = this.db.prepare('SELECT id FROM purchases WHERE id = ?').get(params.documentId);
      if (!purchaseExists) {
        this.db.prepare("INSERT OR IGNORE INTO locations (id, name) VALUES (1, 'Main Store')").run();
        this.db.prepare("INSERT OR IGNORE INTO suppliers (id, supplier_code, name, phone) VALUES (1, 'SUP-0001', 'Main Supplier', '03001234567')").run();
        this.db.prepare(`
          INSERT OR IGNORE INTO purchases (id, purchase_number, supplier_id, location_id, subtotal_minor, total_minor, created_by)
          VALUES (?, ?, 1, 1, 0, 0, 1)
        `).run(params.documentId, `PO-${params.documentId}`);
      }

      const info = this.db.prepare(`
        INSERT INTO purchase_lines (
          purchase_id, product_id, unit_id, quantity_scaled, unit_cost_minor, line_total_minor,
          entered_quantity, entered_unit_id, conversion_numerator, conversion_denominator,
          base_quantity_scaled, base_unit_cost_minor
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.documentId,
        params.productId,
        params.enteredUnitId,
        baseConversion.normalizedBaseQuantityScaled,
        params.unitPriceMinor,
        Math.round(params.enteredQuantity * params.unitPriceMinor),
        params.enteredQuantity,
        params.enteredUnitId,
        baseConversion.conversionNumerator,
        baseConversion.conversionDenominator,
        baseConversion.normalizedBaseQuantityScaled,
        priceConversion.convertedPriceMinor
      );

      return {
        lineId: Number(info.lastInsertRowid),
        conversionNumerator: baseConversion.conversionNumerator,
        conversionDenominator: baseConversion.conversionDenominator,
        normalizedBaseQuantity: baseConversion.normalizedBaseQuantity,
        baseUnitPriceMinor: priceConversion.convertedPriceMinor
      };
    }
  }

  /**
   * Query document line snapshot
   */
  public getDocumentLineSnapshot(documentType: 'SALE' | 'PURCHASE', lineId: number | string): any {
    const table = documentType === 'SALE' ? 'sale_lines' : 'purchase_lines';
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(lineId);
  }

  /**
   * Create a unit
   */
  public createUnit(dto: CreateUnitDto, actor: ActorContext): Unit {
    const role = (actor.role || '').toLowerCase();
    if (role === 'cashier' || role === 'clerk') {
      throw new ForbiddenConversionError('You do not have permission to create measurement units.');
    }

    if (!dto.name || !dto.name.trim()) {
      throw new UnitConversionError('Unit name is required.');
    }
    if (!dto.abbreviation || !dto.abbreviation.trim()) {
      throw new UnitConversionError('Unit abbreviation is required.');
    }
    if (dto.decimalPrecision < 0 || dto.decimalPrecision > 4) {
      throw new UnitConversionError('Decimal precision must be between 0 and 4.');
    }

    const businessId = dto.businessId || actor.businessId || '00000000-0000-0000-0000-000000000001';

    const info = this.db.prepare(`
      INSERT INTO units (
        business_id, name, symbol, dimension, precision_scale,
        abbreviation, unit_type, decimal_precision, is_active
      )
      VALUES (?, ?, ?, UPPER(?), ?, ?, ?, ?, 1)
    `).run(
      businessId,
      dto.name.trim(),
      dto.abbreviation.trim(),
      dto.unitType,
      dto.decimalPrecision,
      dto.abbreviation.trim(),
      dto.unitType,
      dto.decimalPrecision
    );

    const id = Number(info.lastInsertRowid);

    this.logAudit({
      businessId,
      actor,
      action: 'UNIT_CREATED',
      entityType: 'unit',
      entityId: String(id),
      details: JSON.stringify({ name: dto.name, abbreviation: dto.abbreviation, unitType: dto.unitType })
    });

    return {
      id,
      businessId,
      name: dto.name.trim(),
      abbreviation: dto.abbreviation.trim(),
      unitType: dto.unitType,
      decimalPrecision: dto.decimalPrecision,
      isActive: true
    };
  }

  /**
   * List units
   */
  public listUnits(businessId?: string): Unit[] {
    const rows = this.db.prepare(`
      SELECT id, business_id, name,
             COALESCE(abbreviation, symbol, name) as abbreviation,
             LOWER(COALESCE(unit_type, dimension, 'count')) as unit_type,
             COALESCE(decimal_precision, precision_scale, 0) as decimal_precision,
             COALESCE(is_active, 1) as is_active,
             created_at, updated_at
      FROM units
      WHERE is_active = 1
      ORDER BY name ASC
    `).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      name: r.name,
      abbreviation: r.abbreviation,
      unitType: r.unit_type,
      decimalPrecision: r.decimal_precision,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  /**
   * Get configured conversions for a product
   */
  public getProductConversions(productId: string | number): ProductUnitConversion[] {
    const rows = this.db.prepare(`
      SELECT c.id, c.business_id, c.product_id,
             COALESCE(c.from_unit_id, c.unit_id) as from_unit_id,
             u.name as from_unit_name,
             COALESCE(u.abbreviation, u.symbol) as from_unit_abbreviation,
             COALESCE(c.to_base_factor_numerator, c.base_units_numerator) as numerator,
             COALESCE(c.to_base_factor_denominator, c.base_units_denominator, 1) as denominator,
             COALESCE(c.is_purchase_unit, 0) as is_purchase_unit,
             COALESCE(c.is_sale_unit, 0) as is_sale_unit,
             COALESCE(c.is_default_purchase_unit, 0) as is_default_purchase_unit,
             COALESCE(c.is_default_sale_unit, 0) as is_default_sale_unit,
             c.barcode, c.created_at, c.updated_at
      FROM product_unit_conversions c
      LEFT JOIN units u ON (c.from_unit_id = u.id OR c.unit_id = u.id)
      WHERE c.product_id = ?
    `).all(productId) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      productId: r.product_id,
      fromUnitId: r.from_unit_id,
      fromUnitName: r.from_unit_name,
      fromUnitAbbreviation: r.from_unit_abbreviation,
      toBaseFactorNumerator: Number(r.numerator),
      toBaseFactorDenominator: Number(r.denominator),
      isPurchaseUnit: Boolean(r.is_purchase_unit),
      isSaleUnit: Boolean(r.is_sale_unit),
      isDefaultPurchaseUnit: Boolean(r.is_default_purchase_unit),
      isDefaultSaleUnit: Boolean(r.is_default_sale_unit),
      barcode: r.barcode,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}
