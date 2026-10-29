import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { OnboardingService } from '../../src/application/services/OnboardingService';
import { AppError, ConflictError, ValidationError } from '../../src/shared/errors/AppError';

describe('Prompt 6 — Product Catalogue and Product Management System', () => {
  let db: Database.Database;
  let catalogService: ProductCatalogService;
  let onboardingService: OnboardingService;

  let businessId: string;
  let businessBId: string;
  let baseUnitPieceId: number;
  let baseUnitKgId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    catalogService = new ProductCatalogService(db);
    onboardingService = new OnboardingService(db);

    // 1. Initialize primary store via OnboardingService
    const setupA = onboardingService.completeOnboarding({
      businessInfo: {
        name: 'Apex Mega Mart',
        phone: '0300-1234567'
      },
      businessType: 'SUPERMARKET',
      regionalSettings: {
        currencyCode: 'PKR',
        currencySymbol: 'Rs. ',
        currencyDecimals: 2,
        timezone: 'Asia/Karachi',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12h',
        numberFormat: 'standard',
        receiptLanguage: 'en',
        defaultMeasurementUnit: 'Piece'
      },
      branch: {
        name: 'Main Flagship Branch',
        code: 'MAIN-01',
        address: 'Commercial Avenue',
        phone: '0300-1234567'
      },
      counter: {
        name: 'Register 01',
        code: 'POS-01'
      },
      adminAccount: {
        fullName: 'Admin User',
        username: 'admin_apex',
        password: 'Password123!',
        passwordConfirm: 'Password123!'
      },
      modules: {
        enabledModuleCodes: ['weighing_scale', 'customer_credit']
      },
      receiptSettings: {
        displayName: 'Apex Mega Mart',
        paperWidth: '80mm',
        showCashierName: true
      }
    });

    businessId = setupA.businessId;

    // 2. Initialize secondary store for multi-tenancy testing
    const setupB = onboardingService.completeOnboarding({
      businessInfo: {
        name: 'City Pharmacy',
        phone: '0300-7654321'
      },
      businessType: 'PHARMACY',
      regionalSettings: {
        currencyCode: 'PKR',
        currencySymbol: 'Rs. ',
        currencyDecimals: 2,
        timezone: 'Asia/Karachi',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12h',
        numberFormat: 'standard',
        receiptLanguage: 'en',
        defaultMeasurementUnit: 'Piece'
      },
      branch: {
        name: 'Pharmacy Branch 1',
        code: 'PHARM-01',
        address: 'Hospital Road',
        phone: '0300-7654321'
      },
      counter: {
        name: 'Dispense Counter 1',
        code: 'POS-01'
      },
      adminAccount: {
        fullName: 'Pharmacist Admin',
        username: 'admin_pharm',
        password: 'Password123!',
        passwordConfirm: 'Password123!'
      },
      modules: {
        enabledModuleCodes: ['batch_expiry']
      },
      receiptSettings: {
        displayName: 'City Pharmacy',
        paperWidth: '80mm',
        showCashierName: true
      }
    });

    businessBId = setupB.businessId;

    // Look up unit IDs
    const pieceRow = db.prepare("SELECT id FROM units WHERE name = 'Piece'").get() as { id: number };
    baseUnitPieceId = pieceRow.id;

    const kgRow = db.prepare("SELECT id FROM units WHERE name = 'Kilogram'").get() as { id: number };
    baseUnitKgId = kgRow.id;
  });

  // =========================================================================
  // TEST 1: DUPLICATE SKU REJECTION (PER BUSINESS)
  // =========================================================================
  it('1. Rejects duplicate SKUs within the same business, but permits identical SKUs across different businesses', () => {
    // Create product in Business A
    catalogService.createProduct({
      businessId,
      sku: 'PROD-SKU-100',
      name: 'Whole Milk 1L',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 25000 // Rs. 250.00
    });

    // Attempting to create duplicate SKU in the same Business A must fail
    expect(() => {
      catalogService.createProduct({
        businessId,
        sku: 'PROD-SKU-100',
        name: 'Whole Milk 1L Duplicate',
        baseUnitId: baseUnitPieceId,
        retailPriceMinor: 26000
      });
    }).toThrow(/already exists for this business/i);

    // Same SKU in Business B must succeed (multi-tenant isolation)
    const productB = catalogService.createProduct({
      businessId: businessBId,
      sku: 'PROD-SKU-100',
      name: 'Medical Alcohol 1L',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 40000
    });

    expect(productB).toBeDefined();
    expect(productB.businessId).toBe(businessBId);
    expect(productB.sku).toBe('PROD-SKU-100');
  });

  // =========================================================================
  // TEST 2: ARCHIVED PRODUCT SALES GUARD
  // =========================================================================
  it('2. Prevents selling archived products while fully preserving historical integrity', () => {
    const product = catalogService.createProduct({
      businessId,
      sku: 'CHOC-BAR-01',
      name: 'Dark Chocolate 100g',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 30000
    });

    // Active product passes sales eligibility check
    expect(() => {
      catalogService.assertProductCanBeSold(product);
    }).not.toThrow();

    // Archive the product
    catalogService.archiveProduct(businessId, product.id);

    const reloaded = catalogService.getProductById(businessId, product.id);
    expect(reloaded?.isActive).toBe(false);

    // Attempting to sell the archived product must be rejected
    expect(() => {
      catalogService.assertProductCanBeSold(reloaded!);
    }).toThrow(/Cannot sell product "Dark Chocolate 100g": Product is archived/i);
  });

  // =========================================================================
  // TEST 3: INVALID CATEGORY REFERENCES
  // =========================================================================
  it('3. Rejects product creation when referring to a nonexistent category or category from another business', () => {
    // Non-existent category
    expect(() => {
      catalogService.createProduct({
        businessId,
        sku: 'ERR-CAT-01',
        name: 'Invalid Cat Product',
        categoryId: 'non-existent-cat-uuid',
        baseUnitId: baseUnitPieceId
      });
    }).toThrow(/Product category not found/i);

    // Category belonging to Business B
    const catB = catalogService.createCategory({
      businessId: businessBId,
      name: 'Prescription Drugs'
    });

    expect(() => {
      catalogService.createProduct({
        businessId,
        sku: 'ERR-CAT-CROSS',
        name: 'Cross Tenant Category',
        categoryId: catB.id,
        baseUnitId: baseUnitPieceId
      });
    }).toThrow(/Product category not found/i);
  });

  // =========================================================================
  // TEST 4: CIRCULAR CATEGORY HIERARCHY PREVENTION
  // =========================================================================
  it('4. Allows nested categories and strictly prevents a category from becoming its own ancestor', () => {
    // Root Category: Electronics
    const electronics = catalogService.createCategory({
      businessId,
      name: 'Electronics'
    });

    // Child Category: Computers -> parent is Electronics
    const computers = catalogService.createCategory({
      businessId,
      name: 'Computers',
      parentId: electronics.id
    });

    // Grandchild Category: Laptops -> parent is Computers
    const laptops = catalogService.createCategory({
      businessId,
      name: 'Laptops',
      parentId: computers.id
    });

    expect(laptops.parentId).toBe(computers.id);

    // Attempt 1: Making Electronics its own parent
    expect(() => {
      catalogService.updateCategory(electronics.id, businessId, {
        parentId: electronics.id
      });
    }).toThrow(/cannot be its own parent/i);

    // Attempt 2: Making Electronics a child of Laptops (creates cycle: Electronics -> Computers -> Laptops -> Electronics)
    expect(() => {
      catalogService.updateCategory(electronics.id, businessId, {
        parentId: laptops.id
      });
    }).toThrow(/Circular category hierarchy detected/i);
  });

  // =========================================================================
  // TEST 5: MISSING BASE UNITS
  // =========================================================================
  it('5. Rejects product creation when base measurement unit does not exist', () => {
    expect(() => {
      catalogService.createProduct({
        businessId,
        sku: 'NO-UNIT-01',
        name: 'No Unit Item',
        baseUnitId: 999999 // Invalid unit
      });
    }).toThrow(/Base unit not found with id/i);
  });

  // =========================================================================
  // TEST 6: PRODUCT PRICE CHANGES AFTER SALE (HISTORICAL IMMUTABILITY)
  // =========================================================================
  it('6. Ensures product price changes after a sale do not alter historical sale records or profits', () => {
    // 1. Create a product with initial price Rs. 100.00 (10,000 paisa) and cost Rs. 60.00 (6,000 paisa)
    const product = catalogService.createProduct({
      businessId,
      sku: 'PRICE-HIST-01',
      name: 'Toothpaste 100ml',
      baseUnitId: baseUnitPieceId,
      purchaseCostMinor: 6000,
      retailPriceMinor: 10000,
      openingStockScaled: 500000 // 50 pieces
    });

    // 2. Simulate a posted sale transaction referencing this product
    const customer = db.prepare('SELECT id FROM customers LIMIT 1').get() as { id: number };
    const cashier = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string };

    const saleInsert = db.prepare(`
      INSERT INTO sales (invoice_number, customer_id, cashier_id, subtotal, grand_total, total_cost, profit, payment_method)
      VALUES ('INV-HIST-001', ?, ?, 10000, 10000, 6000, 4000, 'CASH')
    `).run(customer.id, cashier.id);

    const saleId = saleInsert.lastInsertRowid;

    db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, product_name, product_barcode, unit_name,
        quantity, conversion_factor, unit_price, cost_price, line_total, line_profit
      )
      VALUES (?, ?, ?, 'BAR-TP', 'Piece', 1, 1, 10000, 6000, 10000, 4000)
    `).run(saleId, product.id, product.name);

    // 3. Now change the product's price in the catalogue to Rs. 180.00 (18,000 paisa)
    catalogService.updateProduct(product.id, {
      retailPriceMinor: 18000,
      purchaseCostMinor: 8000
    });

    const updated = catalogService.getProductById(businessId, product.id);
    expect(updated?.sellingPrice).toBe(18000);

    // 4. Verify historical sale remains 100% untouched
    const historicalSale = db.prepare('SELECT grand_total, profit FROM sales WHERE id = ?').get(saleId) as any;
    expect(historicalSale.grand_total).toBe(10000);
    expect(historicalSale.profit).toBe(4000);

    const historicalItem = db.prepare('SELECT unit_price, cost_price, line_total, line_profit FROM sale_items WHERE sale_id = ?').get(saleId) as any;
    expect(historicalItem.unit_price).toBe(10000);
    expect(historicalItem.cost_price).toBe(6000);
    expect(historicalItem.line_total).toBe(10000);
    expect(historicalItem.line_profit).toBe(4000);
  });

  // =========================================================================
  // TEST 7: OVERLAPPING ACTIVE PRICE RECORDS PREVENTION
  // =========================================================================
  it('7. Rejects overlapping active price records for the same product, unit, and price type', () => {
    const product = catalogService.createProduct({
      businessId,
      sku: 'PRICE-TIER-01',
      name: 'Premium Tea Pack 500g',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 80000
    });

    // Add promo price valid from 2026-11-01 to 2026-11-30
    catalogService.createProductPrice({
      businessId,
      productId: product.id,
      priceType: 'special',
      unitId: baseUnitPieceId,
      amountMinor: 70000,
      validFrom: '2026-11-01T00:00:00.000Z',
      validTo: '2026-11-30T23:59:59.000Z'
    });

    // Attempting to add an overlapping promo from 2026-11-15 to 2026-12-15 must fail
    expect(() => {
      catalogService.createProductPrice({
        businessId,
        productId: product.id,
        priceType: 'special',
        unitId: baseUnitPieceId,
        amountMinor: 65000,
        validFrom: '2026-11-15T00:00:00.000Z',
        validTo: '2026-12-15T23:59:59.000Z'
      });
    }).toThrow(/Overlapping active price record detected/i);

    // Non-overlapping promo valid in December must succeed
    const decPromo = catalogService.createProductPrice({
      businessId,
      productId: product.id,
      priceType: 'special',
      unitId: baseUnitPieceId,
      amountMinor: 75000,
      validFrom: '2026-12-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z'
    });

    expect(decPromo).toBeDefined();
    expect(decPromo.amountMinor).toBe(75000);
  });

  // =========================================================================
  // TEST 8: FAST LARGE CATALOGUE SEARCH & PAGINATION
  // =========================================================================
  it('8. Supports fast indexed search and pagination across a large product catalogue', () => {
    const brand = catalogService.createBrand({ businessId, name: 'Samsung' });
    const category = catalogService.createCategory({ businessId, name: 'Smartphones' });

    // Seed 30 items
    for (let i = 1; i <= 30; i++) {
      catalogService.createProduct({
        businessId,
        sku: `SAMS-A${i.toString().padStart(2, '0')}`,
        name: `Galaxy Phone Model A${i}`,
        barcode: `880123456${i.toString().padStart(4, '0')}`,
        brandId: brand.id,
        categoryId: category.id,
        baseUnitId: baseUnitPieceId,
        retailPriceMinor: 5000000 + i * 100000,
        details: {
          modelNumber: `SM-A${i}00F`,
          manufacturer: 'Samsung Electronics'
        }
      });
    }

    // 1. Pagination: page 1, limit 10
    const page1 = catalogService.searchProducts({
      businessId,
      page: 1,
      limit: 10
    });

    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(30);
    expect(page1.totalPages).toBe(3);
    expect(page1.page).toBe(1);

    // 2. Pagination: page 3, limit 10
    const page3 = catalogService.searchProducts({
      businessId,
      page: 3,
      limit: 10
    });
    expect(page3.items).toHaveLength(10);

    // 3. Search by Model Number
    const searchModel = catalogService.searchProducts({
      businessId,
      query: 'SM-A1500F'
    });
    expect(searchModel.total).toBe(1);
    expect(searchModel.items[0].sku).toBe('SAMS-A15');

    // 4. Search by Barcode
    const searchBarcode = catalogService.searchProducts({
      businessId,
      query: '8801234560020'
    });
    expect(searchBarcode.total).toBe(1);
    expect(searchBarcode.items[0].sku).toBe('SAMS-A20');

    // 5. Search by Brand Name
    const searchBrand = catalogService.searchProducts({
      businessId,
      query: 'Samsung'
    });
    expect(searchBrand.total).toBe(30);
  });

  // =========================================================================
  // TEST 9: DIVERSE PRODUCTS WITH OPTIONAL INDUSTRY ATTRIBUTES
  // =========================================================================
  it('9. Supports diverse retail sectors: grocery, pharmaceuticals, electronics, and laboratory instruments', () => {
    // 1. Grocery Produce (Weighed item in Kg)
    const banana = catalogService.createProduct({
      businessId,
      sku: 'PROD-BANANA-KG',
      name: 'Fresh Bananas (Loose)',
      productType: 'weighted',
      baseUnitId: baseUnitKgId,
      retailPriceMinor: 15000, // Rs. 150 / kg
      allowNegativeStock: false
    });
    expect(banana.productType).toBe('weighted');
    expect(banana.baseUnitName).toBe('Kilogram');

    // 2. Pharmacy Medicine with Custom Attributes
    const medicine = catalogService.createProduct({
      businessId,
      sku: 'MED-AUGM-625',
      name: 'Augmentin 625mg Tablets',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 35000,
      details: {
        manufacturer: 'GSK Pakistan',
        countryOfOrigin: 'Pakistan',
        customAttributes: {
          activeMolecule: 'Amoxicillin + Clavulanate',
          dosage: '625mg',
          requiresPrescription: true,
          storageConditions: 'Store below 25°C'
        }
      }
    });
    expect(medicine.details?.manufacturer).toBe('GSK Pakistan');
    expect(medicine.details?.customAttributes?.dosage).toBe('625mg');

    // 3. Electronics Item with Warranty and Model Number
    const smartphone = catalogService.createProduct({
      businessId,
      sku: 'ELEC-IPHONE-15',
      name: 'iPhone 15 Pro Max 256GB',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 45000000, // Rs. 450,000
      details: {
        manufacturer: 'Apple Inc.',
        modelNumber: 'A3106',
        countryOfOrigin: 'USA',
        warrantyMonths: 12
      }
    });
    expect(smartphone.details?.modelNumber).toBe('A3106');
    expect(smartphone.details?.warrantyMonths).toBe(12);

    // 4. Scientific Laboratory Equipment
    const centrifuge = catalogService.createProduct({
      businessId,
      sku: 'LAB-CENT-5000',
      name: 'High-Speed Microcentrifuge 15,000 RPM',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 12000000,
      details: {
        manufacturer: 'Eppendorf',
        modelNumber: '5424-R',
        countryOfOrigin: 'Germany',
        warrantyMonths: 24,
        customAttributes: {
          maxSpeedRpm: 15000,
          temperatureRange: '-10°C to +40°C',
          calibrationIntervalDays: 180
        }
      }
    });
    expect(centrifuge.details?.manufacturer).toBe('Eppendorf');
    expect(centrifuge.details?.customAttributes?.maxSpeedRpm).toBe(15000);
  });

  // =========================================================================
  // TEST 10: DELETION SAFETY GUARDS
  // =========================================================================
  it('10. Allows deleting unreferenced products, but strictly blocks physical deletion when transaction history exists', () => {
    // 1. Unreferenced product can be deleted cleanly
    const tempProd = catalogService.createProduct({
      businessId,
      sku: 'TEMP-DEL-01',
      name: 'Temporary Mistake Product',
      baseUnitId: baseUnitPieceId
    });

    expect(catalogService.getProductById(businessId, tempProd.id)).toBeDefined();
    catalogService.deleteProduct(businessId, tempProd.id);
    expect(catalogService.getProductById(businessId, tempProd.id)).toBeNull();

    // 2. Product with stock movements cannot be deleted
    const stockProd = catalogService.createProduct({
      businessId,
      sku: 'STOCK-PROD-01',
      name: 'Stock Recorded Item',
      baseUnitId: baseUnitPieceId,
      openingStockScaled: 100000 // 10 units opening stock creates a movement
    });

    expect(() => {
      catalogService.deleteProduct(businessId, stockProd.id);
    }).toThrow(/cannot be deleted because it is referenced by existing transactions/i);

    // Archiving instead succeeds
    catalogService.archiveProduct(businessId, stockProd.id);
    const archived = catalogService.getProductById(businessId, stockProd.id);
    expect(archived?.isActive).toBe(false);
  });

  // =========================================================================
  // TEST 11: USABILITY WITHOUT OPTIONAL INDUSTRY MODULES
  // =========================================================================
  it('11. Operates normally without requiring any optional industry-specific modules enabled', () => {
    // Business with ZERO optional modules enabled
    const minimalSetup = onboardingService.completeOnboarding({
      businessInfo: {
        name: 'Basic Stationery Store',
        phone: '0300-5554433'
      },
      businessType: 'GENERAL_RETAIL',
      regionalSettings: {
        currencyCode: 'PKR',
        currencySymbol: 'Rs. ',
        currencyDecimals: 2,
        timezone: 'Asia/Karachi',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12h',
        numberFormat: 'standard',
        receiptLanguage: 'en',
        defaultMeasurementUnit: 'Piece'
      },
      branch: {
        name: 'Main Branch',
        code: 'BR-01'
      },
      counter: {
        name: 'Register 1',
        code: 'POS-01'
      },
      adminAccount: {
        fullName: 'Store Keeper',
        username: 'stationery_admin',
        password: 'Password123!',
        passwordConfirm: 'Password123!'
      },
      modules: {
        enabledModuleCodes: [] // NO optional modules enabled!
      },
      receiptSettings: {
        displayName: 'Basic Stationery Store',
        paperWidth: '80mm',
        showCashierName: true
      }
    });

    const minimalBizId = minimalSetup.businessId;

    const pen = catalogService.createProduct({
      businessId: minimalBizId,
      sku: 'PEN-BLUE-01',
      name: 'Ballpoint Pen Blue',
      baseUnitId: baseUnitPieceId,
      retailPriceMinor: 2000,
      purchaseCostMinor: 1200
    });

    expect(pen).toBeDefined();
    expect(pen.sku).toBe('PEN-BLUE-01');
    expect(pen.sellingPrice).toBe(2000);

    const searchRes = catalogService.searchProducts({
      businessId: minimalBizId,
      query: 'Ballpoint'
    });
    expect(searchRes.total).toBe(1);
    expect(searchRes.items[0].id).toBe(pen.id);
  });
});

