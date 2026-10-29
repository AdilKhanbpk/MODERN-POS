import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import {
  UnitConversionService,
  UnsupportedConversionError,
  ForbiddenConversionError,
  UnitConversionError
} from '../../src/application/services/UnitConversionService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { InvalidQuantityPrecisionError } from '../../src/domain/units/scaled-quantity';

describe('Prompt 7 — Units of Measurement, Rational Product Conversions & Immutability', () => {
  let db: Database.Database;
  let conversionService: UnitConversionService;
  let catalogService: ProductCatalogService;

  const businessId = '00000000-0000-0000-0000-000000000001';

  let unitPieceId: any;
  let unitDozenId: any;
  let unitCartonId: any;
  let unitKgId: any;
  let unitGramId: any;
  let unitBoxId: any;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    conversionService = new UnitConversionService(db);
    catalogService = new ProductCatalogService(db);

    // Look up default seeded units
    const getUnitId = (name: string) => {
      const row = db.prepare('SELECT id FROM units WHERE name = ?').get(name) as { id: any };
      return row.id;
    };

    unitPieceId = getUnitId('Piece');
    unitDozenId = getUnitId('Dozen');
    unitCartonId = getUnitId('Carton');
    unitKgId = getUnitId('Kilogram');
    unitGramId = getUnitId('Gram');
    unitBoxId = getUnitId('Box');
  });

  // =========================================================================
  // 1. PIECE-TO-DOZEN CONVERSION
  // =========================================================================
  it('1. Accurately converts piece-to-dozen using exact rational arithmetic', () => {
    // Create product: Eggs
    const eggs = catalogService.createProduct({
      businessId,
      sku: 'EGGS-FARM-01',
      name: 'Farm Fresh Organic Eggs',
      baseUnitId: unitPieceId,
      retailPriceMinor: 3000 // Rs. 30 per egg
    });

    // Configure 1 Dozen = 12 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: eggs.id,
        fromUnitId: unitDozenId,
        toBaseFactorNumerator: 12,
        toBaseFactorDenominator: 1,
        isSaleUnit: true,
        isPurchaseUnit: true
      },
      { userId: 1, role: 'Administrator' }
    );

    // Enter 3 Dozen -> Should equal 36 Pieces
    const result = conversionService.convertToBaseQuantity(eggs.id, 3, unitDozenId);
    expect(result.enteredQuantity).toBe(3);
    expect(result.conversionNumerator).toBe(12);
    expect(result.conversionDenominator).toBe(1);
    expect(result.normalizedBaseQuantity).toBe(36);
    expect(result.normalizedBaseQuantityScaled).toBe(360000); // 36 * 10,000

    // Convert back from 36 base pieces to Dozen
    const reverse = conversionService.convertFromBaseQuantity(eggs.id, 36, unitDozenId);
    expect(reverse.convertedQuantity).toBe(3);
  });

  // =========================================================================
  // 2. DIFFERENT CARTON FACTORS FOR DIFFERENT PRODUCTS
  // =========================================================================
  it('2. Enforces product-specific carton factors (Product A = 24 Pieces, Product B = 6 Pieces)', () => {
    // Product A: Soda Cans (Carton has 24 pieces)
    const soda = catalogService.createProduct({
      businessId,
      sku: 'SODA-CAN-330',
      name: 'Sparkling Soda 330ml',
      baseUnitId: unitPieceId,
      retailPriceMinor: 10000
    });

    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: soda.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // Product B: Premium Shampoo (Carton has 6 bottles)
    const shampoo = catalogService.createProduct({
      businessId,
      sku: 'SHAMP-BOT-500',
      name: 'Herbal Shampoo 500ml',
      baseUnitId: unitPieceId,
      retailPriceMinor: 85000
    });

    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: shampoo.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 6,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // 5 Cartons of Soda -> 5 * 24 = 120 Pieces
    const sodaConv = conversionService.convertToBaseQuantity(soda.id, 5, unitCartonId);
    expect(sodaConv.normalizedBaseQuantity).toBe(120);

    // 5 Cartons of Shampoo -> 5 * 6 = 30 Pieces
    const shampooConv = conversionService.convertToBaseQuantity(shampoo.id, 5, unitCartonId);
    expect(shampooConv.normalizedBaseQuantity).toBe(30);

    // Verify isolation: Neither product's factor affects the other
    expect(sodaConv.conversionNumerator).toBe(24);
    expect(shampooConv.conversionNumerator).toBe(6);
  });

  // =========================================================================
  // 3. FRACTIONAL WEIGHT QUANTITIES & PRECISION LIMITS
  // =========================================================================
  it('3. Supports fractional weight quantities within unit precision scale and rejects precision overflow', () => {
    // Product: Loose Basmati Rice (Base unit: Gram, precision 1)
    const rice = catalogService.createProduct({
      businessId,
      sku: 'RICE-BASMATI-LOOSE',
      name: 'Super Kernel Basmati Rice',
      baseUnitId: unitGramId,
      retailPriceMinor: 40 // 40 paisa per gram
    });

    // 1 Kilogram (precision 3) = 1,000 Grams
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: rice.id,
        fromUnitId: unitKgId,
        toBaseFactorNumerator: 1000,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // 1.500 Kg -> Exactly 1,500 Grams
    const weightResult = conversionService.convertToBaseQuantity(rice.id, 1.5, unitKgId);
    expect(weightResult.normalizedBaseQuantity).toBe(1500);
    expect(weightResult.normalizedBaseQuantityScaled).toBe(15000000); // 1500 * 10000

    // 0.250 Kg -> Exactly 250 Grams
    const quarterKg = conversionService.convertToBaseQuantity(rice.id, 0.25, unitKgId);
    expect(quarterKg.normalizedBaseQuantity).toBe(250);

    // Exceeding unit precision scale: Kilogram allows 3 decimals. 1.2345 kg has 4 decimals -> must throw!
    expect(() => {
      conversionService.convertToBaseQuantity(rice.id, 1.2345, unitKgId);
    }).toThrow(InvalidQuantityPrecisionError);

    // Discrete unit precision: Piece has precision 0. Fractional 1.5 pieces must throw!
    const pen = catalogService.createProduct({
      businessId,
      sku: 'PEN-BLUE-01',
      name: 'Ballpoint Pen Blue',
      baseUnitId: unitPieceId
    });

    expect(() => {
      conversionService.convertToBaseQuantity(pen.id, 1.5, unitPieceId);
    }).toThrow(InvalidQuantityPrecisionError);
  });

  // =========================================================================
  // 4. UNSUPPORTED / UNCONFIGURED CONVERSIONS
  // =========================================================================
  it('4. Rejects unsupported conversions with an explicit descriptive error', () => {
    const milk = catalogService.createProduct({
      businessId,
      sku: 'MILK-TETRA-1L',
      name: 'Full Cream Milk 1L',
      baseUnitId: unitPieceId
    });

    // Box has NOT been configured for Milk
    expect(() => {
      conversionService.convertToBaseQuantity(milk.id, 2, unitBoxId);
    }).toThrow(UnsupportedConversionError);

    expect(() => {
      conversionService.convertFromBaseQuantity(milk.id, 10, unitBoxId);
    }).toThrow(UnsupportedConversionError);
  });

  // =========================================================================
  // 5. ZERO AND NEGATIVE CONVERSION FACTORS
  // =========================================================================
  it('5. Strictly rejects zero or negative conversion factors and negative quantities', () => {
    const biscuit = catalogService.createProduct({
      businessId,
      sku: 'BISC-CHOCO-01',
      name: 'Chocolate Cream Biscuits',
      baseUnitId: unitPieceId
    });

    // Zero numerator
    expect(() => {
      conversionService.saveProductUnitConversion(
        {
          businessId,
          productId: biscuit.id,
          fromUnitId: unitBoxId,
          toBaseFactorNumerator: 0,
          toBaseFactorDenominator: 1
        },
        { userId: 1, role: 'Administrator' }
      );
    }).toThrow(/must be a positive integer/i);

    // Negative numerator
    expect(() => {
      conversionService.saveProductUnitConversion(
        {
          businessId,
          productId: biscuit.id,
          fromUnitId: unitBoxId,
          toBaseFactorNumerator: -12,
          toBaseFactorDenominator: 1
        },
        { userId: 1, role: 'Administrator' }
      );
    }).toThrow(/must be a positive integer/i);

    // Negative quantity
    expect(() => {
      conversionService.convertToBaseQuantity(biscuit.id, -5, unitPieceId);
    }).toThrow(UnitConversionError);
  });

  // =========================================================================
  // 6. HISTORICAL CONVERSION SNAPSHOTS AFTER CONVERSION FACTOR CHANGES
  // =========================================================================
  it('6. Ensures changing a conversion factor later does NOT mutate historical transaction lines', () => {
    const juice = catalogService.createProduct({
      businessId,
      sku: 'JUICE-ORANGE-250',
      name: 'Orange Juice 250ml',
      baseUnitId: unitPieceId,
      purchaseCostMinor: 4000 // Rs. 40.00 base unit cost
    });

    // Initially 1 Carton = 24 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: juice.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // Post a purchase line: 5 Cartons @ Rs. 960.00 (96,000 paisa) per carton
    // Equivalent piece cost: 96,000 / 24 = 4,000 paisa (Rs. 40.00)
    const snap1 = conversionService.recordDocumentLineSnapshot({
      documentType: 'PURCHASE',
      documentId: 101,
      productId: juice.id,
      enteredQuantity: 5,
      enteredUnitId: unitCartonId,
      unitPriceMinor: 96000
    });

    expect(snap1.conversionNumerator).toBe(24);
    expect(snap1.normalizedBaseQuantity).toBe(120); // 5 * 24
    expect(snap1.baseUnitPriceMinor).toBe(4000);

    // Later: Manufacturer downsizes carton from 24 to 20 pieces!
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: juice.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 20,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // Post a NEW purchase line after the change: 5 Cartons @ Rs. 800.00 (80,000 paisa)
    const snap2 = conversionService.recordDocumentLineSnapshot({
      documentType: 'PURCHASE',
      documentId: 102,
      productId: juice.id,
      enteredQuantity: 5,
      enteredUnitId: unitCartonId,
      unitPriceMinor: 80000
    });

    expect(snap2.conversionNumerator).toBe(20);
    expect(snap2.normalizedBaseQuantity).toBe(100); // 5 * 20
    expect(snap2.baseUnitPriceMinor).toBe(4000);

    // Verify historical immutability of the FIRST purchase line from the database!
    const historicalLine1 = conversionService.getDocumentLineSnapshot('PURCHASE', snap1.lineId);
    expect(historicalLine1.conversion_numerator).toBe(24);
    expect(historicalLine1.entered_quantity).toBe(5);
    expect(historicalLine1.base_quantity_scaled).toBe(1200000); // 120 * 10,000
    expect(historicalLine1.base_unit_cost_minor).toBe(4000);
  });

  // =========================================================================
  // 7. PURCHASE IN CARTONS & SALE IN PIECES (INVENTORY TRACKING)
  // =========================================================================
  it('7. Accurately coordinates purchase in cartons and sales in pieces (120 in - 24 out = 96 remaining)', () => {
    const tea = catalogService.createProduct({
      businessId,
      sku: 'TEA-BAGS-100',
      name: 'Black Tea 100 Bags',
      baseUnitId: unitPieceId,
      openingStockScaled: 0
    });

    // Product A: 1 Carton = 24 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: tea.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // 1 Dozen = 12 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: tea.id,
        fromUnitId: unitDozenId,
        toBaseFactorNumerator: 12,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // Step A: Purchase 5 Cartons -> 5 * 24 = 120 Pieces
    const purchaseResult = conversionService.convertToBaseQuantity(tea.id, 5, unitCartonId);
    expect(purchaseResult.normalizedBaseQuantity).toBe(120);

    // Stock movement: IN +120 pieces
    db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(
      purchaseResult.normalizedBaseQuantityScaled,
      tea.id
    );

    // Step B: Sale 2 Dozens -> 2 * 12 = 24 Pieces
    const saleResult = conversionService.convertToBaseQuantity(tea.id, 2, unitDozenId);
    expect(saleResult.normalizedBaseQuantity).toBe(24);

    // Stock movement: OUT -24 pieces
    const currentStockRow = db.prepare('SELECT current_stock FROM products WHERE id = ?').get(tea.id) as any;
    const remainingStock = currentStockRow.current_stock - saleResult.normalizedBaseQuantityScaled;
    db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(remainingStock, tea.id);

    // Step C: Verify remaining stock equals exactly 96 Pieces
    const finalStockRow = db.prepare('SELECT current_stock FROM products WHERE id = ?').get(tea.id) as any;
    expect(finalStockRow.current_stock).toBe(960000); // 96 * 10,000 scaled base units
    expect(finalStockRow.current_stock / 10000).toBe(96);
  });

  // =========================================================================
  // 8. RETURN IN A DIFFERENT UNIT FROM ORIGINAL SALE
  // =========================================================================
  it('8. Handles customer returns in a different unit from the original sale', () => {
    // Sold: 1 Carton (24 Pieces) for Rs. 2,400 (240,000 paisa)
    // Return: 6 Pieces
    const soap = catalogService.createProduct({
      businessId,
      sku: 'SOAP-BAR-100',
      name: 'Beauty Soap 100g',
      baseUnitId: unitPieceId
    });

    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: soap.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    const returnCalc = conversionService.calculateSaleReturn({
      productId: soap.id,
      originalSaleUnitId: unitCartonId,
      originalSaleUnitPriceMinor: 240000, // Rs. 2,400.00
      returnUnitId: unitPieceId,
      returnQuantity: 6
    });

    // Equivalent piece price = 240,000 / 24 = 10,000 paisa (Rs. 100.00)
    // Refund = 6 * 10,000 = 60,000 paisa (Rs. 600.00)
    // Restock = 6 Pieces
    expect(returnCalc.refundAmountMinor).toBe(60000);
    expect(returnCalc.normalizedBaseQuantityToRestock).toBe(6);
  });

  // =========================================================================
  // 9. PRICE CONVERSION & ROUNDING AT CURRENCY PRECISION
  // =========================================================================
  it('9. Converts unit prices with exact division and defined rounding policy', () => {
    const coffee = catalogService.createProduct({
      businessId,
      sku: 'COFFEE-CAN-200',
      name: 'Instant Roast Coffee 200g',
      baseUnitId: unitPieceId
    });

    // 1 Carton = 24 Pieces
    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: coffee.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 24,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    // Carton sale price: 2,400 minor units (Rs. 24.00)
    // Piece price = 2400 / 24 = 100 minor units
    const priceConv = conversionService.convertUnitPrice(coffee.id, unitCartonId, unitPieceId, 2400);
    expect(priceConv.convertedPriceMinor).toBe(100);
    expect(priceConv.roundingRemainder).toBe(0);

    // Fractional division: 1,000 minor units across 3 pieces
    // 1000 / 3 = 333.333 -> HALF_UP rounds to 333
    const trioUnit = conversionService.createUnit(
      {
        name: 'Trio Pack',
        abbreviation: 'trio',
        unitType: 'count',
        decimalPrecision: 0
      },
      { userId: 1, role: 'Administrator' }
    );

    conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: coffee.id,
        fromUnitId: trioUnit.id,
        toBaseFactorNumerator: 3,
        toBaseFactorDenominator: 1
      },
      { userId: 1, role: 'Administrator' }
    );

    const roundedPrice = conversionService.convertUnitPrice(
      coffee.id,
      trioUnit.id,
      unitPieceId,
      1000,
      'HALF_UP'
    );
    expect(roundedPrice.convertedPriceMinor).toBe(333);
    expect(roundedPrice.roundingRemainder).toBe(1);

    // In EXACT mode: must reject non-zero remainder
    expect(() => {
      conversionService.convertUnitPrice(coffee.id, trioUnit.id, unitPieceId, 1000, 'EXACT');
    }).toThrow(/cannot be divided exactly/i);
  });

  // =========================================================================
  // 10. PERMISSION ENFORCEMENT & IMMUTABLE AUDIT LOGGING
  // =========================================================================
  it('10. Blocks cashiers from modifying conversion factors and records audit events for authorized changes', () => {
    const pen = catalogService.createProduct({
      businessId,
      sku: 'PEN-GEL-BLACK',
      name: 'Black Gel Pen 0.5mm',
      baseUnitId: unitPieceId
    });

    // Cashier attempt must throw ForbiddenConversionError
    expect(() => {
      conversionService.saveProductUnitConversion(
        {
          businessId,
          productId: pen.id,
          fromUnitId: unitCartonId,
          toBaseFactorNumerator: 50,
          toBaseFactorDenominator: 1
        },
        { userId: 42, role: 'cashier' }
      );
    }).toThrow(ForbiddenConversionError);

    // Store Manager attempt succeeds
    const conv = conversionService.saveProductUnitConversion(
      {
        businessId,
        productId: pen.id,
        fromUnitId: unitCartonId,
        toBaseFactorNumerator: 50,
        toBaseFactorDenominator: 1
      },
      { userId: 2, role: 'Manager' }
    );

    expect(conv.toBaseFactorNumerator).toBe(50);

    // Verify audit log entry was created
    const auditCount = db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs
      WHERE action = 'UNIT_CONVERSION_CREATED' AND entity_type = 'product_unit_conversion'
    `).get() as { count: number };

    expect(auditCount.count).toBeGreaterThanOrEqual(1);
  });
});
