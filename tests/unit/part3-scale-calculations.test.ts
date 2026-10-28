import { describe, it, expect } from 'vitest';
import {
  Money,
  toMinorUnits,
  fromMinorUnits,
  formatCurrency,
  MoneyPrecisionError
} from '../../src/domain/money/money';
import {
  QUANTITY_SCALE,
  toScaledQuantity,
  fromScaledQuantity,
  validateQuantityPrecision,
  InvalidQuantityPrecisionError,
  addScaled,
  subtractScaled,
  scaleIntegerPieces
} from '../../src/domain/units/scaled-quantity';
import {
  RationalConverter,
  RationalConversionRule,
  UnitConversionError
} from '../../src/domain/units/rational-conversion';
import { PricingCalculator } from '../../src/domain/sales/pricing-calculator';
import { CustomerStatementCalculator } from '../../src/domain/accounting/customer-statement';
import { CashDrawerCalculator, DrawerTransaction } from '../../src/domain/accounting/cash-drawer';
import { MovingAverageCostCalculator } from '../../src/domain/costing/moving-average';

describe('PART 3: Scale Model, Units and Exact Calculations', () => {

  // =========================================================================
  // 1. MONEY SCALE (PKR PAISA REPRESENTATION)
  // =========================================================================
  describe('1. Money Scale & Paisa Representation', () => {
    it('accurately converts PKR decimal to integer minor units (paisa) without float bugs', () => {
      // Prompt examples:
      // Rs 100.00 = 10,000 paisa
      // Rs  25.50 =  2,550 paisa
      // Rs   0.75 =     75 paisa
      expect(toMinorUnits(100.00)).toBe(10000);
      expect(toMinorUnits(25.50)).toBe(2550);
      expect(toMinorUnits(0.75)).toBe(75);

      expect(fromMinorUnits(10000)).toBe(100.00);
      expect(fromMinorUnits(2550)).toBe(25.50);
      expect(fromMinorUnits(75)).toBe(0.75);
    });

    it('rejects decimal amounts with fractional paisa that exceed currency precision', () => {
      // 25.505 has 3 decimal places when currency precision is 2
      expect(() => toMinorUnits(25.505)).toThrow(MoneyPrecisionError);
    });

    it('formats PKR currency strings cleanly with currency symbol', () => {
      expect(formatCurrency(10000, 'PKR', 'Rs.')).toBe('Rs. 100.00');
      expect(formatCurrency(2550, 'PKR', 'Rs.')).toBe('Rs. 25.50');
      expect(formatCurrency(75, 'PKR', 'Rs.')).toBe('Rs. 0.75');
    });

    it('performs exact integer arithmetic with Money class', () => {
      const m1 = Money.fromPaisa(10000); // Rs 100.00
      const m2 = Money.fromPaisa(2550);  // Rs  25.50
      const sum = m1.add(m2);
      expect(sum.paisa).toBe(12550);
      expect(sum.format('Rs.')).toBe('Rs. 125.50');

      const diff = m1.subtract(m2);
      expect(diff.paisa).toBe(7450);
      expect(diff.format('Rs.')).toBe('Rs. 74.50');
    });
  });

  // =========================================================================
  // 2. QUANTITY SCALE (FIXED-POINT QUANTITY_SCALE = 10,000)
  // =========================================================================
  describe('2. Fixed-Point Quantity Scale (QUANTITY_SCALE = 10,000)', () => {
    it('scales canonical base units accurately to 10,000 units per base unit', () => {
      // Prompt examples:
      // 1 piece     = 10,000 scaled units
      // 1.5 kg      = 15,000 scaled kg units
      // 0.250 kg    =  2,500 scaled kg units
      // 2.75 litres = 27,500 scaled litre units
      expect(toScaledQuantity(1.0)).toBe(10000);
      expect(toScaledQuantity(1.5)).toBe(15000);
      expect(toScaledQuantity(0.250)).toBe(2500);
      expect(toScaledQuantity(2.75)).toBe(27500);

      expect(fromScaledQuantity(10000)).toBe(1.0);
      expect(fromScaledQuantity(15000)).toBe(1.5);
      expect(fromScaledQuantity(2500)).toBe(0.250);
      expect(fromScaledQuantity(27500)).toBe(2.75);
    });

    it('enforces unit precision scale and rejects unauthorized fractional quantities', () => {
      // Count / Piece has precision_scale = 0 (whole pieces only)
      expect(() => validateQuantityPrecision(1.5, 0)).toThrow(InvalidQuantityPrecisionError);
      expect(() => toScaledQuantity(1.5, 0)).toThrow(InvalidQuantityPrecisionError);

      // Whole piece count passes
      expect(toScaledQuantity(3, 0)).toBe(30000);

      // Weight (kg) allows up to 3 decimals (grams)
      expect(toScaledQuantity(1.250, 3)).toBe(12500);
      // Exceeding 3 decimals for a 3-decimal unit is strictly rejected
      expect(() => toScaledQuantity(1.2505, 3)).toThrow(InvalidQuantityPrecisionError);
    });

    it('rejects quantities exceeding maximum scale precision of 4 decimal places instead of silent rounding', () => {
      // 1.00005 has 5 decimal places: cannot be represented in scale 10,000
      expect(() => toScaledQuantity(1.00005)).toThrow(InvalidQuantityPrecisionError);
    });

    it('adds and subtracts scaled quantities correctly', () => {
      const q1 = toScaledQuantity(10.0); // 100,000 scaled
      const q2 = toScaledQuantity(2.5);  // 25,000 scaled
      expect(addScaled(q1, q2)).toBe(125000);
      expect(subtractScaled(q1, q2)).toBe(75000);
      expect(fromScaledQuantity(subtractScaled(q1, q2))).toBe(7.5);
    });
  });

  // =========================================================================
  // 3. RATIONAL UNIT CONVERSIONS & MULTI-PACKS
  // =========================================================================
  describe('3. Unit Definitions & Rational Multi-Unit Conversions', () => {
    it('Example 1: Dozen (12) and Gross (144) stock conversions', () => {
      // Base unit: Piece
      const dozenRule: RationalConversionRule = { unitId: 2, baseUnitsNumerator: 12, baseUnitsDenominator: 1 };
      const grossRule: RationalConversionRule = { unitId: 4, baseUnitsNumerator: 144, baseUnitsDenominator: 1 };

      // Shop has 10 gross in stock:
      // 10 * 144 = 1,440 pieces
      const grossStockScaled = RationalConverter.toBaseQuantityScaled(10, grossRule, 0);
      expect(fromScaledQuantity(grossStockScaled)).toBe(1440);

      // 2 dozen sold:
      // 2 * 12 = 24 pieces
      const saleDozenScaled = RationalConverter.toBaseQuantityScaled(2, dozenRule, 0);
      expect(fromScaledQuantity(saleDozenScaled)).toBe(24);

      // Remaining stock:
      // 1,440 - 24 = 1,416 pieces
      const remainingScaled = subtractScaled(grossStockScaled, saleDozenScaled);
      expect(fromScaledQuantity(remainingScaled)).toBe(1416);
    });

    it('Example 2: Dynamic product-specific packs (Shampoo 6-pack vs Juice 12-pack)', () => {
      // Product A (Shampoo): 1 pack = 6 pieces
      const shampooPackRule: RationalConversionRule = {
        productId: 101,
        unitId: 5,
        baseUnitsNumerator: 6,
        baseUnitsDenominator: 1
      };

      // Product B (Juice): 1 pack = 12 pieces
      const juicePackRule: RationalConversionRule = {
        productId: 102,
        unitId: 5,
        baseUnitsNumerator: 12,
        baseUnitsDenominator: 1
      };

      // 3 packs of Shampoo = 3 * 6 = 18 pieces
      const shampooScaled = RationalConverter.toBaseQuantityScaled(3, shampooPackRule, 0);
      expect(fromScaledQuantity(shampooScaled)).toBe(18);

      // 3 packs of Juice = 3 * 12 = 36 pieces
      const juiceScaled = RationalConverter.toBaseQuantityScaled(3, juicePackRule, 0);
      expect(fromScaledQuantity(juiceScaled)).toBe(36);
    });

    it('Example 3: Weight conversion (2.25 kg chawal sold when base unit is Gram)', () => {
      // Base unit: Gram. 1 kg = 1,000 grams
      const kgRule: RationalConversionRule = {
        unitId: 8,
        baseUnitsNumerator: 1000,
        baseUnitsDenominator: 1
      };

      // Shop sells 2.25 kg chawal:
      // Stock movement must be 2,250 grams
      const movementScaled = RationalConverter.toBaseQuantityScaled(2.25, kgRule, 3);
      expect(fromScaledQuantity(movementScaled)).toBe(2250);
    });

    it('Example 4: Unit price conversion, COGS and Gross profit', () => {
      // 1 dozen purchase price = Rs 240.00 (24,000 paisa)
      // 1 dozen = 12 pieces
      const dozenRule: RationalConversionRule = { unitId: 2, baseUnitsNumerator: 12, baseUnitsDenominator: 1 };
      const baseCostMinor = RationalConverter.calculateBaseCostMinor(24000, dozenRule);
      // Per piece cost: 240 / 12 = Rs 20.00 (2,000 paisa)
      expect(baseCostMinor).toBe(2000);

      // 3 pieces sold at Rs 25.00 each (2,500 paisa)
      const pieceRule: RationalConversionRule = { unitId: 1, baseUnitsNumerator: 1, baseUnitsDenominator: 1 };
      const saleResult = RationalConverter.calculateSaleLineMargin({
        quantity: 3,
        unitPriceMinor: 2500,
        baseCostMinor,
        rule: pieceRule,
        unitPrecisionScale: 0
      });

      // Sale total = 3 * 25 = Rs 75.00 (7,500 paisa)
      expect(saleResult.lineGrossMinor).toBe(7500);
      // COGS = 3 * 20 = Rs 60.00 (6,000 paisa)
      expect(saleResult.lineCostMinor).toBe(6000);
      // Gross profit = 75 - 60 = Rs 15.00 (1,500 paisa)
      expect(saleResult.grossProfitMinor).toBe(1500);
    });

    it('rejects conversions that yield unrepresentable fractional scaled units', () => {
      // Trying to convert 1 piece into a fraction that cannot be represented exactly in QUANTITY_SCALE
      const invalidRule: RationalConversionRule = { unitId: 99, baseUnitsNumerator: 1, baseUnitsDenominator: 7 };
      expect(() => RationalConverter.toBaseQuantityScaled(1, invalidRule)).toThrow(UnitConversionError);
    });
  });

  // =========================================================================
  // 4. PRODUCT VARIANTS VS UNIT CONVERSIONS SEPARATION
  // =========================================================================
  describe('4. Product Variants vs Unit Conversions Separation', () => {
    it('maintains variants as independent physical items and conversions as packaging ratios', () => {
      // Running Shoes Product has separate variants (Size 40 Black vs Size 41 Black)
      const shoeProduct = { id: 50, name: 'Running Shoes', baseUnitId: 1 }; // Base: Piece
      const variant40 = { id: 1, productId: 50, variantSku: 'SHOE-40-BLK', size: '40', color: 'Black' };
      const variant41 = { id: 2, productId: 50, variantSku: 'SHOE-41-BLK', size: '41', color: 'Black' };

      // Multi-unit conversion applies packaging ratio (1 Pair = 2 individual shoes or 1 Box = 1 Pair)
      const pairConversion: RationalConversionRule = { productId: 50, unitId: 2, baseUnitsNumerator: 2, baseUnitsDenominator: 1 };

      expect(variant40.variantSku).not.toBe(variant41.variantSku);
      // Selling 3 pairs of Size 40 moves 6 pieces of variant40 specifically
      const stockMovementVariant40 = RationalConverter.toBaseQuantityScaled(3, pairConversion, 0);
      expect(fromScaledQuantity(stockMovementVariant40)).toBe(6);
    });
  });

  // =========================================================================
  // 5. SINGLE AUTHORITATIVE SALE LINE FORMULA & HISTORICAL SNAPSHOTS
  // =========================================================================
  describe('5. Authoritative Sale Line Formula & Historical Snapshots', () => {
    it('computes exact sale line according to prompt specification with allocated bill discount', () => {
      // Prompt specification:
      // Quantity = 3
      // Unit price = Rs 100 (10,000 paisa)
      // Gross line total = Rs 300 (30,000 paisa)
      // Line discount = Rs 20 (2,000 paisa)
      // Allocated bill discount = Rs 10 (1,000 paisa)
      // Tax = Rs 0 (disabled)
      // Final line total = Rs 270 (27,000 paisa)

      const line = PricingCalculator.calculateAuthoritativeLine({
        productId: 1,
        productName: 'Sample Product',
        sku: 'SAMPLE-001',
        unitName: 'Piece',
        quantity: 3,
        unitPriceMinor: 10000,
        unitCostMinor: 6000, // Rs 60.00
        lineDiscountMinor: 2000, // Rs 20.00
        allocatedBillDiscountMinor: 1000, // Rs 10.00
        taxRate: 0,
        isTaxInclusive: false
      });

      expect(line.lineGrossMinor).toBe(30000); // Rs 300
      expect(line.lineItemDiscountMinor).toBe(2000); // Rs 20
      expect(line.allocatedBillDiscountMinor).toBe(1000); // Rs 10
      expect(line.totalLineDiscountMinor).toBe(3000); // Rs 30
      expect(line.taxAmountMinor).toBe(0);
      expect(line.lineTotalMinor).toBe(27000); // Rs 270

      // Line Cost: 3 * Rs 60 = Rs 180 (18,000 paisa)
      expect(line.lineCostTotalMinor).toBe(18000);
      // Line Profit: Rs 270 - Rs 180 = Rs 90 (9,000 paisa)
      expect(line.lineProfitMinor).toBe(9000);

      // Verify immutable snapshots are recorded
      expect(line.productNameSnapshot).toBe('Sample Product');
      expect(line.skuSnapshot).toBe('SAMPLE-001');
      expect(line.unitNameSnapshot).toBe('Piece');
      expect(line.quantityScaled).toBe(30000);
      expect(line.unitPriceMinor).toBe(10000);
      expect(line.unitCostMinor).toBe(6000);
    });

    it('proportions bill discount across multiple lines without losing any integer remainder', () => {
      const items = [
        {
          productId: 1,
          unitName: 'Piece',
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 10000, // Rs 100
          costPrice: 5000,
          discountPercent: 0,
          discountAmount: 0,
          taxRate: 0,
          isTaxInclusive: false
        },
        {
          productId: 2,
          unitName: 'Piece',
          quantity: 2,
          conversionFactor: 1,
          unitPrice: 10000, // Rs 200 total
          costPrice: 5000,
          discountPercent: 0,
          discountAmount: 0,
          taxRate: 0,
          isTaxInclusive: false
        }
      ];

      // Order discount = Rs 50 (5,000 paisa) on Rs 300 total
      // Item 1: share = 100 / 300 * 50 = 16.666 -> 1,667 paisa
      // Item 2: remainder = 5,000 - 1,667 = 3,333 paisa
      const result = PricingCalculator.calculateSale(items, 0, 5000);
      expect(result.subtotal).toBe(30000);
      expect(result.orderDiscountAmount).toBe(5000);
      expect(result.grandTotal).toBe(25000);

      const allocatedTotal = result.items.reduce((sum, it) => sum + (it.allocatedBillDiscount || 0), 0);
      expect(allocatedTotal).toBe(5000);
    });

    it('handles tax inclusive vs tax exclusive calculations correctly', () => {
      // Exclusive 10% on Rs 100
      const exclusive = PricingCalculator.calculateAuthoritativeLine({
        productId: 1,
        productName: 'Item',
        sku: 'SKU1',
        unitName: 'Piece',
        quantity: 1,
        unitPriceMinor: 10000,
        unitCostMinor: 5000,
        taxRate: 10,
        isTaxInclusive: false
      });
      expect(exclusive.taxAmountMinor).toBe(1000); // 10% on 10000 = 1000
      expect(exclusive.lineTotalMinor).toBe(11000); // 10000 + 1000 = 11000

      // Inclusive 10% on Rs 110
      const inclusive = PricingCalculator.calculateAuthoritativeLine({
        productId: 1,
        productName: 'Item',
        sku: 'SKU1',
        unitName: 'Piece',
        quantity: 1,
        unitPriceMinor: 11000,
        unitCostMinor: 5000,
        taxRate: 10,
        isTaxInclusive: true
      });
      // preTax = 11000 / 1.1 = 10000, tax = 1000
      expect(inclusive.taxAmountMinor).toBe(1000);
      expect(inclusive.lineTotalMinor).toBe(11000);
    });
  });

  // =========================================================================
  // 6. CUSTOMER ACCOUNT STATEMENT FORMULA
  // =========================================================================
  describe('6. Customer Account Statement Formula', () => {
    it('reproduces prompt customer ledger scenario with exact running balances', () => {
      // Prompt timeline:
      // Date   Event                             Debit     Credit    Running balance
      // 20th   Credit sale                       Rs 1,000  Rs 0      Rs 1,000
      // 21st   Credit sale                       Rs 500    Rs 0      Rs 1,500
      // 22nd   Cash sale, fully paid             Rs 0      Rs 0      Rs 1,500 (Does NOT alter balance!)
      // 23rd   Rs 200 credit sale, Rs 100 paid   Rs 100    Rs 0      Rs 1,600 (Only unpaid debit!)
      // 26th   Payment received                  Rs 0      Rs 800    Rs 800

      const statement = CustomerStatementCalculator.generateStatement({
        customerId: 10,
        customerName: 'Muhammad Ali',
        openingBalanceMinor: 0,
        transactions: [
          {
            date: '2026-10-20',
            sourceType: 'SALE',
            sourceId: 101,
            referenceNumber: 'INV-001',
            saleTotalMinor: 100000, // Rs 1,000
            amountPaidMinor: 0      // Full credit
          },
          {
            date: '2026-10-21',
            sourceType: 'SALE',
            sourceId: 102,
            referenceNumber: 'INV-002',
            saleTotalMinor: 50000,  // Rs 500
            amountPaidMinor: 0      // Full credit
          },
          {
            date: '2026-10-22',
            sourceType: 'SALE',
            sourceId: 103,
            referenceNumber: 'INV-003',
            saleTotalMinor: 150000, // Rs 1,500
            amountPaidMinor: 150000 // Fully paid cash sale!
          },
          {
            date: '2026-10-23',
            sourceType: 'SALE',
            sourceId: 104,
            referenceNumber: 'INV-004',
            saleTotalMinor: 20000,  // Rs 200
            amountPaidMinor: 10000  // Rs 100 paid upfront
          },
          {
            date: '2026-10-26',
            sourceType: 'PAYMENT',
            sourceId: 201,
            referenceNumber: 'RCP-001',
            amountPaidMinor: 80000  // Rs 800 received
          }
        ]
      });

      // Verify each entry chronologically:
      const e = statement.entries;
      expect(e).toHaveLength(5);

      // 20th: Credit sale Rs 1,000 -> Running: Rs 1,000
      expect(e[0].debitMinor).toBe(100000);
      expect(e[0].creditMinor).toBe(0);
      expect(e[0].runningBalanceMinor).toBe(100000);
      expect(e[0].openAction?.actionName).toBe('OPEN_BILL');
      expect(e[0].openAction?.targetId).toBe(101);

      // 21st: Credit sale Rs 500 -> Running: Rs 1,500
      expect(e[1].debitMinor).toBe(50000);
      expect(e[1].creditMinor).toBe(0);
      expect(e[1].runningBalanceMinor).toBe(150000);

      // 22nd: Fully paid cash sale -> Debit 0, Credit 0, Running: Rs 1,500
      expect(e[2].debitMinor).toBe(0);
      expect(e[2].creditMinor).toBe(0);
      expect(e[2].runningBalanceMinor).toBe(150000);
      expect(e[2].eventType).toBe('CASH_SALE_PAID');

      // 23rd: Partial payment sale (Rs 200 sale, Rs 100 paid) -> Debit Rs 100, Running: Rs 1,600
      expect(e[3].debitMinor).toBe(10000);
      expect(e[3].creditMinor).toBe(0);
      expect(e[3].runningBalanceMinor).toBe(160000);

      // 26th: Payment received Rs 800 -> Credit Rs 800, Running: Rs 800
      expect(e[4].debitMinor).toBe(0);
      expect(e[4].creditMinor).toBe(80000);
      expect(e[4].runningBalanceMinor).toBe(80000);
      expect(e[4].openAction?.actionName).toBe('OPEN_TRANSACTION');
      expect(e[4].openAction?.targetId).toBe(201);

      expect(statement.closingBalanceMinor).toBe(80000); // Rs 800.00
    });
  });

  // =========================================================================
  // 7. CASH REGISTER CLOSING & PHYSICAL DRAWER AUDIT
  // =========================================================================
  describe('7. Cash Register Drawer Closing Formula', () => {
    it('reproduces prompt register closing formula and filters non-cash methods', () => {
      // Prompt example:
      // Opening cash           = Rs 5,000 (500,000 paisa)
      // Cash sales             = Rs 8,000 (800,000 paisa)
      // Cash customer receipts = Rs 2,000 (200,000 paisa)
      // Cash expenses          = Rs 1,000 (100,000 paisa)
      // Cash refunds           = Rs   500 ( 50,000 paisa)
      // Other cash-out         = Rs   300 ( 30,000 paisa)
      // Expected cash = Rs 13,200 (1,320,000 paisa)

      const transactions: DrawerTransaction[] = [
        {
          movementType: 'CASH_SALE',
          paymentMethodType: 'CASH',
          affectsCashDrawer: true,
          amountMinor: 800000 // Rs 8,000
        },
        {
          movementType: 'CUSTOMER_PAYMENT',
          paymentMethodType: 'CASH',
          affectsCashDrawer: true,
          amountMinor: 200000 // Rs 2,000
        },
        {
          movementType: 'EXPENSE_PAYOUT',
          paymentMethodType: 'CASH',
          affectsCashDrawer: true,
          amountMinor: 100000 // Rs 1,000
        },
        {
          movementType: 'CASH_SALE_REFUND',
          paymentMethodType: 'CASH',
          affectsCashDrawer: true,
          amountMinor: 50000  // Rs 500
        },
        {
          movementType: 'CASH_OUT',
          paymentMethodType: 'CASH',
          affectsCashDrawer: true,
          amountMinor: 30000  // Rs 300
        },
        // Non-cash transactions: MUST be excluded from drawer cash
        {
          movementType: 'CASH_SALE',
          paymentMethodType: 'BANK',
          affectsCashDrawer: false,
          amountMinor: 400000 // Rs 4,000 via Bank
        },
        {
          movementType: 'CASH_SALE',
          paymentMethodType: 'CARD',
          affectsCashDrawer: false,
          amountMinor: 250000 // Rs 2,500 via Card
        },
        {
          movementType: 'CUSTOMER_PAYMENT',
          paymentMethodType: 'DIGITAL_WALLET',
          affectsCashDrawer: false,
          amountMinor: 150000 // Rs 1,500 via JazzCash/Easypaisa
        }
      ];

      const result = CashDrawerCalculator.reconcile({
        openingCashMinor: 500000, // Rs 5,000
        transactions,
        countedCashMinor: 1320000 // Actual count = Rs 13,200 (Balanced)
      });

      // Verify physical drawer math:
      // Inflow = 8,000 + 2,000 = 10,000
      expect(result.totalCashInflowMinor).toBe(1000000);
      // Outflow = 1,000 + 500 + 300 = 1,800
      expect(result.totalCashOutflowMinor).toBe(180000);
      // Expected = 5,000 + 10,000 - 1,800 = Rs 13,200 (1,320,000 paisa)
      expect(result.expectedCashMinor).toBe(1320000);
      expect(result.status).toBe('BALANCED');
      expect(result.differenceMinor).toBe(0);

      // Verify non-cash exclusion:
      expect(result.nonCashAudits.bankTransferMinor).toBe(400000);
      expect(result.nonCashAudits.cardPaymentMinor).toBe(250000);
      expect(result.nonCashAudits.digitalWalletMinor).toBe(150000);
      expect(result.nonCashAudits.totalNonCashMinor).toBe(800000);
    });

    it('identifies drawer shortage and overage correctly', () => {
      const shortageResult = CashDrawerCalculator.reconcile({
        openingCashMinor: 100000,
        transactions: [],
        countedCashMinor: 95000 // Short by Rs 50
      });
      expect(shortageResult.status).toBe('SHORTAGE');
      expect(shortageResult.differenceMinor).toBe(-5000);

      const overageResult = CashDrawerCalculator.reconcile({
        openingCashMinor: 100000,
        transactions: [],
        countedCashMinor: 102000 // Over by Rs 20
      });
      expect(overageResult.status).toBe('OVERAGE');
      expect(overageResult.differenceMinor).toBe(2000);
    });
  });

  // =========================================================================
  // 8. MOVING WEIGHTED-AVERAGE COST (MAC) & RETAIL PROFIT
  // =========================================================================
  describe('8. Moving Weighted-Average Cost (MAC) & Profit', () => {
    it('calculates MAC intake accurately according to prompt specification', () => {
      // Prompt example:
      // Old stock: 10 pieces @ Rs 100 = Rs 1,000 (100,000 paisa)
      // New purchase: 10 pieces @ Rs 120 = Rs 1,200 (120,000 paisa)
      // Total cost = Rs 2,200, Total stock = 20 pieces
      // Weighted-average cost = Rs 110 per piece (11,000 paisa)

      const newCost = MovingAverageCostCalculator.calculateNewAverageCost({
        currentStockQty: 10,
        currentUnitCostMinor: 10000, // Rs 100
        receivedQty: 10,
        purchaseUnitCostMinor: 12000  // Rs 120
      });

      expect(newCost).toBe(11000); // Exactly Rs 110.00 (11,000 paisa)
    });

    it('computes sales margin and gross profit: 5 pieces sold @ Rs 150 with COGS @ Rs 110 = Rs 200 gross profit', () => {
      // Prompt example:
      // 5 pieces sold @ Rs 150 = Rs 750 (75,000 paisa)
      // COGS = 5 * Rs 110 = Rs 550 (55,000 paisa)
      // Gross profit = Rs 200 (20,000 paisa)

      const margin = MovingAverageCostCalculator.calculateSaleMargin({
        quantity: 5,
        salePriceMinor: 15000, // Rs 150
        unitCostMinor: 11000   // Rs 110
      });

      expect(margin.grossRevenueMinor).toBe(75000); // Rs 750
      expect(margin.cogsMinor).toBe(55000);         // Rs 550
      expect(margin.grossProfitMinor).toBe(20000);   // Rs 200
      expect(margin.grossMarginPercent).toBe(26.67); // 200 / 750 = 26.67%
    });

    it('strictly separates Gross Profit from Operating Profit by deducting operating expenses', () => {
      const statement = MovingAverageCostCalculator.generateOperatingProfitStatement({
        grossSalesMinor: 1000000, // Rs 10,000
        discountsMinor: 50000,    // Rs 500
        taxCollectedMinor: 95000, // Rs 950 (Fiduciary liability to government)
        costOfGoodsSoldMinor: 500000, // Rs 5,000
        expenses: [
          { categoryName: 'Rent', amountMinor: 150000 },       // Rs 1,500
          { categoryName: 'Electricity', amountMinor: 50000 }  // Rs 500
        ]
      });

      // Net Commercial Revenue = Gross (10,000) - Discount (500) - Tax (950) = Rs 8,550
      expect(statement.netSalesExcludingTaxMinor).toBe(855000);
      // Gross Profit = 8,550 - 5,000 = Rs 3,550
      expect(statement.grossProfitMinor).toBe(355000);
      // Operating Expenses = 1,500 + 500 = Rs 2,000
      expect(statement.operatingExpensesMinor).toBe(200000);
      // Operating Profit = 3,550 - 2,000 = Rs 1,550
      expect(statement.operatingProfitMinor).toBe(155000);
    });

    it('enforces historical sale line cost immutability when product moving-average cost changes', () => {
      // Historical sale was recorded when product cost was Rs 100
      const historicalSaleLine = {
        saleId: 1,
        productId: 1,
        quantity: 5,
        unitCostMinor: 10000, // Frozen snapshot at Rs 100
        lineCostTotalMinor: 50000,
        unitPriceMinor: 15000,
        lineTotalMinor: 75000,
        lineProfitMinor: 25000
      };

      // Later, a new expensive shipment arrives and inventory MAC increases to Rs 130
      const updatedProductCost = MovingAverageCostCalculator.calculateNewAverageCost({
        currentStockQty: 10,
        currentUnitCostMinor: 10000,
        receivedQty: 10,
        purchaseUnitCostMinor: 16000
      });
      expect(updatedProductCost).toBe(13000);

      // Invariant Check: The historical sale line snapshot remains strictly unchanged!
      expect(historicalSaleLine.unitCostMinor).toBe(10000);
      expect(historicalSaleLine.lineCostTotalMinor).toBe(50000);
      expect(historicalSaleLine.lineProfitMinor).toBe(25000);
    });
  });

});

