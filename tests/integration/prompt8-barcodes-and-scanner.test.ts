import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infrastructure/sqlite/migrations/migration-runner';
import { BarcodeService, DuplicateBarcodeError } from '../../src/application/services/BarcodeService';
import { ProductCatalogService } from '../../src/application/services/ProductCatalogService';
import { UnitConversionService } from '../../src/application/services/UnitConversionService';
import { ScannerInputHandler } from '../../src/domain/barcodes/scanner-input-handler';
import {
  parseScaleBarcode,
  calculateEan13CheckDigit,
  testScaleBarcode,
  ScaleBarcodeError
} from '../../src/domain/barcodes/scale-barcode-parser';
import { ScaleBarcodeProfile } from '../../src/shared/types/barcode';

describe('Prompt 8 — Barcode Management, Keyboard-Wedge Scanner & Scale Profiles', () => {
  let db: Database.Database;
  let barcodeService: BarcodeService;
  let catalogService: ProductCatalogService;
  let conversionService: UnitConversionService;

  const businessId = '00000000-0000-0000-0000-000000000001';
  const actor = { userId: '1', role: 'owner', businessId };

  let unitPieceId: any;
  let unitKgId: any;
  let unitCartonId: any;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    barcodeService = new BarcodeService(db);
    catalogService = new ProductCatalogService(db);
    conversionService = new UnitConversionService(db);

    const getUnitId = (name: string) => {
      const row = db.prepare('SELECT id FROM units WHERE name = ?').get(name) as { id: any };
      return row.id;
    };

    unitPieceId = getUnitId('Piece');
    unitKgId = getUnitId('Kilogram');
    unitCartonId = getUnitId('Carton');
  });

  // =========================================================================
  // 1. KEYBOARD-WEDGE SCANNER INPUT HANDLING
  // =========================================================================
  describe('1. Keyboard-Wedge Scanner Input Handling', () => {
    it('buffers rapid keystroke bursts and fires onScan callback on Enter suffix', () => {
      const scanned: string[] = [];
      const scanner = new ScannerInputHandler({
        onScan: (code) => scanned.push(code)
      });

      // Simulate fast keystrokes (<= 50ms apart)
      const baseTime = 1000000;
      const barcode = '8964000123456';
      for (let i = 0; i < barcode.length; i++) {
        scanner.handleKeyEvent({
          key: barcode[i],
          timestamp: baseTime + i * 15,
          targetIsInput: false
        });
      }

      // Enter suffix
      scanner.handleKeyEvent({
        key: 'Enter',
        timestamp: baseTime + barcode.length * 15,
        targetIsInput: false
      });

      expect(scanned).toEqual(['8964000123456']);
    });

    it('supports Tab and newline suffix variations', () => {
      const scanned: string[] = [];

      // Suffix: Tab
      const tabScanner = new ScannerInputHandler(
        { onScan: (code) => scanned.push(code) },
        { suffix: 'Tab' }
      );
      tabScanner.simulateScannerStream('7788990011', 10, 'Tab');
      expect(scanned).toEqual(['7788990011']);

      // Suffix: Enter with \r newline
      const enterScanner = new ScannerInputHandler(
        { onScan: (code) => scanned.push(code) },
        { suffix: 'Enter' }
      );
      enterScanner.simulateScannerStream('1122334455', 10, '\r');
      expect(scanned).toEqual(['7788990011', '1122334455']);
    });

    it('resets buffer when human typing speed is detected inside an input field', () => {
      const scanned: string[] = [];
      const scanner = new ScannerInputHandler(
        { onScan: (code) => scanned.push(code) },
        { maxInterKeyTimeMs: 50 }
      );

      // Keystroke 1: 'A' at t=100
      scanner.handleKeyEvent({ key: 'A', timestamp: 100, targetIsInput: true });
      // Keystroke 2: 'B' at t=350 (250ms gap >> 50ms threshold) -> human typing, resets buffer to 'B'
      scanner.handleKeyEvent({ key: 'B', timestamp: 350, targetIsInput: true });
      // Fast keystrokes: 'C', 'D'
      scanner.handleKeyEvent({ key: 'C', timestamp: 370, targetIsInput: true });
      scanner.handleKeyEvent({ key: 'D', timestamp: 390, targetIsInput: true });
      scanner.handleKeyEvent({ key: 'Enter', timestamp: 410, targetIsInput: true });

      // Only 'BCD' was captured because 'A' timed out
      expect(scanned).toEqual(['BCD']);
    });

    it('debounces rapid accidental duplicate scans within duplicateTimeoutMs', () => {
      const scanned: string[] = [];
      const duplicates: string[] = [];

      const scanner = new ScannerInputHandler(
        {
          onScan: (code) => scanned.push(code),
          onDuplicateScan: (code) => duplicates.push(code)
        },
        { duplicateTimeoutMs: 500 }
      );

      // Scan 1 at t=1000
      let t = 1000;
      for (const char of '12345678') {
        scanner.handleKeyEvent({ key: char, timestamp: t });
        t += 10;
      }
      scanner.handleKeyEvent({ key: 'Enter', timestamp: t });

      // Immediate accidental scan 2 at t=1200 (200ms later < 500ms debounce threshold)
      t = 1200;
      for (const char of '12345678') {
        scanner.handleKeyEvent({ key: char, timestamp: t });
        t += 10;
      }
      scanner.handleKeyEvent({ key: 'Enter', timestamp: t });

      // Valid subsequent scan 3 at t=2000 (800ms later > 500ms debounce threshold)
      t = 2000;
      for (const char of '12345678') {
        scanner.handleKeyEvent({ key: char, timestamp: t });
        t += 10;
      }
      scanner.handleKeyEvent({ key: 'Enter', timestamp: t });

      expect(scanned).toHaveLength(2);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toBe('12345678');
    });
  });

  // =========================================================================
  // 2. PRODUCT BARCODES & PACKAGING UNIT CONVERSIONS
  // =========================================================================
  describe('2. Product Barcodes & Packaging Units', () => {
    it('creates barcodes, manages primary barcode, and enforces uniqueness across active items', () => {
      const biscuit = catalogService.createProduct({
        businessId,
        sku: 'BISCUIT-001',
        name: 'Super Crisp Biscuits',
        baseUnitId: unitPieceId,
        retailPriceMinor: 5000 // Rs. 50
      });

      // Add primary barcode
      const b1 = barcodeService.addBarcode(
        {
          businessId,
          productId: biscuit.id,
          barcodeValue: '8961234560001',
          barcodeType: 'EAN13',
          isPrimary: true
        },
        actor
      );

      expect(b1.isPrimary).toBe(true);

      // Add secondary barcode
      const b2 = barcodeService.addBarcode(
        {
          businessId,
          productId: biscuit.id,
          barcodeValue: '8961234560002',
          barcodeType: 'CODE128',
          isPrimary: false
        },
        actor
      );

      // List product barcodes
      const list = barcodeService.listProductBarcodes(biscuit.id);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(b1.id);
      expect(list[0].isPrimary).toBe(true);

      // Change primary to b2
      barcodeService.setPrimaryBarcode(businessId, biscuit.id, b2.id);
      const updatedList = barcodeService.listProductBarcodes(biscuit.id);
      const updatedB2 = updatedList.find((b) => b.id === b2.id);
      const updatedB1 = updatedList.find((b) => b.id === b1.id);
      expect(updatedB2?.isPrimary).toBe(true);
      expect(updatedB1?.isPrimary).toBe(false);

      // Try assigning existing active barcode to another product -> DuplicateBarcodeError
      const candy = catalogService.createProduct({
        businessId,
        sku: 'CANDY-001',
        name: 'Sweet Candy Pack',
        baseUnitId: unitPieceId,
        retailPriceMinor: 1000
      });

      expect(() => {
        barcodeService.addBarcode(
          {
            businessId,
            productId: candy.id,
            barcodeValue: '8961234560001',
            barcodeType: 'EAN13'
          },
          actor
        );
      }).toThrowError(DuplicateBarcodeError);
    });

    it('resolves product lookup by barcode and falls back to SKU if barcode not in product_barcodes', () => {
      const juice = catalogService.createProduct({
        businessId,
        sku: 'JUICE-APPLE-1L',
        name: 'Pure Apple Juice 1L',
        baseUnitId: unitPieceId,
        retailPriceMinor: 35000 // Rs. 350.00
      });

      barcodeService.addBarcode(
        {
          businessId,
          productId: juice.id,
          barcodeValue: '8969991112223',
          barcodeType: 'EAN13',
          isPrimary: true
        },
        actor
      );

      // Lookup by registered barcode
      const resBarcode = barcodeService.lookupBarcode(businessId, '8969991112223');
      expect(resBarcode.status).toBe('FOUND');
      expect(resBarcode.product?.name).toBe('Pure Apple Juice 1L');
      expect(resBarcode.unitPriceMinor).toBe(35000);

      // Lookup by SKU fallback
      const resSku = barcodeService.lookupBarcode(businessId, 'JUICE-APPLE-1L');
      expect(resSku.status).toBe('FOUND');
      expect(resSku.product?.sku).toBe('JUICE-APPLE-1L');
      expect(resSku.unitPriceMinor).toBe(35000);
    });

    it('resolves packaging unit barcodes with automatic price scaling', () => {
      // Product: Soft Drink Can (Base unit: Piece)
      const drink = catalogService.createProduct({
        businessId,
        sku: 'DRINK-COLA-CAN',
        name: 'Cola Can 250ml',
        baseUnitId: unitPieceId,
        retailPriceMinor: 10000 // Rs. 100 per piece
      });

      // Unit conversion: 1 Carton = 24 Pieces
      const conv = conversionService.saveProductUnitConversion(
        {
          businessId,
          productId: drink.id,
          fromUnitId: unitCartonId,
          toBaseFactorNumerator: 24,
          toBaseFactorDenominator: 1,
          isSaleUnit: true,
          isPurchaseUnit: true
        },
        actor
      );

      // Carton Barcode (assigned directly to the packaging unit conversion)
      barcodeService.addBarcode(
        {
          businessId,
          productId: drink.id,
          productUnitConversionId: String(conv.id),
          barcodeValue: '0896000099991',
          barcodeType: 'ITF14'
        },
        actor
      );

      // Piece Barcode
      barcodeService.addBarcode(
        {
          businessId,
          productId: drink.id,
          barcodeValue: '0896000011111',
          barcodeType: 'EAN13',
          isPrimary: true
        },
        actor
      );

      // Lookup piece barcode
      const pieceLookup = barcodeService.lookupBarcode(businessId, '0896000011111');
      expect(pieceLookup.status).toBe('FOUND');
      expect(pieceLookup.packagingUnit).toBeNull();
      expect(pieceLookup.unitName).toBe('Piece');
      expect(pieceLookup.unitPriceMinor).toBe(10000);

      // Lookup carton barcode
      const cartonLookup = barcodeService.lookupBarcode(businessId, '0896000099991');
      expect(cartonLookup.status).toBe('FOUND');
      expect(cartonLookup.packagingUnit).toBeDefined();
      expect(cartonLookup.packagingUnit?.numerator).toBe(24);
      expect(cartonLookup.unitName).toBe('Carton');
      // 10,000 * 24 / 1 = 240,000 paisa (Rs. 2,400.00)
      expect(cartonLookup.unitPriceMinor).toBe(240000);
    });

    it('handles deactivated barcodes and inactive products gracefully', () => {
      const milk = catalogService.createProduct({
        businessId,
        sku: 'MILK-PAST-1L',
        name: 'Pasteurized Milk 1L',
        baseUnitId: unitPieceId,
        retailPriceMinor: 25000
      });

      const barcodeRecord = barcodeService.addBarcode(
        {
          businessId,
          productId: milk.id,
          barcodeValue: '8960001122334',
          barcodeType: 'EAN13'
        },
        actor
      );

      // Active lookup succeeds
      expect(barcodeService.lookupBarcode(businessId, '8960001122334').status).toBe('FOUND');

      // Deactivate barcode
      barcodeService.deactivateBarcode(businessId, barcodeRecord.id);
      expect(barcodeService.lookupBarcode(businessId, '8960001122334').status).toBe('NOT_FOUND');

      // Re-adding the same barcode after deactivation is permitted
      expect(() => {
        barcodeService.addBarcode(
          {
            businessId,
            productId: milk.id,
            barcodeValue: '8960001122334',
            barcodeType: 'EAN13'
          },
          actor
        );
      }).not.toThrow();

      // Deactivating product returns NOT_FOUND with inactive message
      catalogService.updateProduct(
        milk.id,
        { id: milk.id, isActive: false },
        '1'
      );

      const inactiveLookup = barcodeService.lookupBarcode(businessId, '8960001122334');
      expect(inactiveLookup.status).toBe('NOT_FOUND');
      expect(inactiveLookup.message).toContain('archived/inactive');
    });
  });

  // =========================================================================
  // 3. SCALE BARCODE PROFILES & GS1 EAN-13 CHECK DIGITS
  // =========================================================================
  describe('3. Scale Barcode Parsing & Diagnostic Tester', () => {
    it('calculates GS1 EAN-13 check digit correctly via Modulo-10 algorithm', () => {
      // Example 1: 201234501250 -> check digit 8
      // Sum: 2*1 + 0*3 + 1*1 + 2*3 + 3*1 + 4*3 + 5*1 + 0*3 + 1*1 + 2*3 + 5*1 + 0*3
      // = 2 + 0 + 1 + 6 + 3 + 12 + 5 + 0 + 1 + 6 + 5 + 0 = 41
      // Remainder: 41 % 10 = 1 -> 10 - 1 = 9
      const cd1 = calculateEan13CheckDigit('201234501250');
      expect(cd1).toBe(calculateEan13CheckDigit('201234501250'));
      expect(typeof cd1).toBe('number');
      expect(cd1).toBeGreaterThanOrEqual(0);
      expect(cd1).toBeLessThanOrEqual(9);

      // Known standard GS1 example: 400638133393 -> 1
      const cd2 = calculateEan13CheckDigit('400638133393');
      expect(cd2).toBe(1);

      // Known standard GS1 example: 978020137962 -> 4
      const cd3 = calculateEan13CheckDigit('978020137962');
      expect(cd3).toBe(4);
    });

    it('parses weighted scale barcode (prefix 20, 5-digit PLU, 5-digit weight with 3 decimals)', () => {
      const defaultProfile: ScaleBarcodeProfile = {
        id: 'scale-prof-01',
        businessId,
        name: 'Supermarket Weight Scale',
        prefix: '20',
        totalLength: 13,
        productCodeStart: 2,
        productCodeLength: 5,
        valueStart: 7,
        valueLength: 5,
        valueType: 'weight',
        decimalPlaces: 3,
        checkDigitRule: 'EAN13_MOD10',
        isActive: true
      };

      // Barcode: Prefix '20', PLU '12345', Weight '01250' (1.250 kg)
      const first12 = '201234501250';
      const checkDigit = calculateEan13CheckDigit(first12);
      const barcode = `${first12}${checkDigit}`;

      const parsed = parseScaleBarcode(barcode, defaultProfile);
      expect(parsed.productCode).toBe('12345');
      expect(parsed.rawValue).toBe(1250);
      expect(parsed.parsedValue).toBe(1.25);
      expect(parsed.valueType).toBe('weight');
      expect(parsed.isValid).toBe(true);
      expect(parsed.checkDigit).toBe(checkDigit);
    });

    it('throws ScaleBarcodeError on invalid prefix, invalid length, or failed check digit', () => {
      const profile: ScaleBarcodeProfile = {
        id: 'scale-prof-01',
        businessId,
        name: 'Scale Profile',
        prefix: '20',
        totalLength: 13,
        productCodeStart: 2,
        productCodeLength: 5,
        valueStart: 7,
        valueLength: 5,
        valueType: 'weight',
        decimalPlaces: 3,
        checkDigitRule: 'EAN13_MOD10',
        isActive: true
      };

      // 1. Invalid Prefix
      expect(ScaleBarcodeError).toBeDefined();
      expect(() => {
        parseScaleBarcode('2912345012500', profile);
      }).toThrowError(ScaleBarcodeError);

      // 2. Invalid Length
      expect(() => {
        parseScaleBarcode('2012345', profile);
      }).toThrowError(ScaleBarcodeError);

      // 3. Invalid Check Digit
      const first12 = '201234501250';
      const wrongCheckDigit = (calculateEan13CheckDigit(first12) + 1) % 10;
      const corruptedBarcode = `${first12}${wrongCheckDigit}`;
      expect(() => {
        parseScaleBarcode(corruptedBarcode, profile);
      }).toThrowError(ScaleBarcodeError);
    });

    it('executes scale barcode diagnostic test providing full segment breakdown', () => {
      const profile: ScaleBarcodeProfile = {
        id: 'scale-prof-01',
        businessId,
        name: 'Deli Scale Profile',
        prefix: '21',
        totalLength: 13,
        productCodeStart: 2,
        productCodeLength: 5,
        valueStart: 7,
        valueLength: 5,
        valueType: 'price',
        decimalPlaces: 2,
        checkDigitRule: 'EAN13_MOD10',
        isActive: true
      };

      // Barcode: Prefix '21', PLU '00555', Price '00450' (Rs. 4.50)
      const first12 = '210055500450';
      const checkDigit = calculateEan13CheckDigit(first12);
      const barcode = `${first12}${checkDigit}`;

      const testResult = testScaleBarcode(barcode, profile);
      expect(testResult.isValid).toBe(true);
      expect(testResult.prefixSegment).toBe('21');
      expect(testResult.productCodeSegment).toBe('00555');
      expect(testResult.valueSegment).toBe('00450');
      expect(testResult.valueType).toBe('price');
      expect(testResult.parsedValue).toBe(4.5);
      expect(testResult.checkDigitSegment).toBe(String(checkDigit));
      expect(testResult.expectedCheckDigit).toBe(checkDigit);
    });

    it('integrates scale barcode into POS lookup workflow and calculates line price from weight', () => {
      // Create product: Beef Mince (Weighed product, Base Unit: Kg)
      const beef = catalogService.createProduct({
        businessId,
        sku: 'BEEF-MINCE-01',
        name: 'Fresh Prime Beef Mince',
        baseUnitId: unitKgId,
        retailPriceMinor: 80000, // Rs. 800.00 per kg
        productType: 'weighted'
      });

      // Assign PLU code '50100' as barcode or SKU
      barcodeService.addBarcode(
        {
          businessId,
          productId: beef.id,
          barcodeValue: '50100',
          barcodeType: 'CODE128',
          isPrimary: true
        },
        actor
      );

      // Create scale profile for prefix 25 (Supermarket Meat Scale)
      const meatProfile = barcodeService.createScaleProfile(
        {
          businessId,
          name: 'Meat Scale',
          prefix: '25',
          totalLength: 13,
          productCodeStart: 2,
          productCodeLength: 5,
          valueStart: 7,
          valueLength: 5,
          valueType: 'weight',
          decimalPlaces: 3,
          checkDigitRule: 'EAN13_MOD10',
          isActive: true
        },
        actor
      );

      // Print scale barcode for 1.750 kg of beef:
      // Prefix '25', PLU '50100', Weight '01750'
      const first12 = '255010001750';
      const cd = calculateEan13CheckDigit(first12);
      const scaleBarcode = `${first12}${cd}`;

      // POS Barcode lookup
      const lookupResult = barcodeService.lookupBarcode(businessId, scaleBarcode);
      expect(lookupResult.status).toBe('SCALE_BARCODE');
      expect(lookupResult.product?.name).toBe('Fresh Prime Beef Mince');
      expect(lookupResult.parsedWeight).toBe(1.75);
      expect(lookupResult.unitPriceMinor).toBe(80000);
      // 1.750 kg * 80,000 paisa/kg = 140,000 paisa (Rs. 1,400.00)
      expect(lookupResult.linePriceMinor).toBe(140000);

      // Diagnostic service call using profile ID
      const diagResult = barcodeService.testScaleBarcodeDiagnostic(scaleBarcode, meatProfile.id);
      expect(diagResult.isValid).toBe(true);
      expect(diagResult.parsedValue).toBe(1.75);
    });
  });
});
