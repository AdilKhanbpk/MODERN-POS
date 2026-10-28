import { describe, it, expect } from 'vitest';
import { PricingCalculator } from '../../src/domain/sales/pricing-calculator';
import { CartItemInput } from '../../src/shared/types';

describe('Domain: PricingCalculator', () => {
  it('calculates line item gross, discounts, tax and totals correctly', () => {
    const items: CartItemInput[] = [
      {
        productId: 1,
        unitName: 'Piece',
        quantity: 2,
        conversionFactor: 1,
        unitPrice: 10000, // Rs. 100.00
        costPrice: 7000,  // Rs. 70.00
        discountPercent: 10, // 10% off
        discountAmount: 0,
        taxRate: 5, // 5% tax exclusive
        isTaxInclusive: false
      }
    ];

    const result = PricingCalculator.calculateSale(items, 0, 0);

    // Gross: 2 * 10000 = 20000
    expect(result.subtotal).toBe(20000);
    // 10% item discount on 20000 = 2000
    expect(result.totalItemDiscount).toBe(2000);
    // Net before tax: 20000 - 2000 = 18000
    // 5% tax on 18000 = 900
    expect(result.totalTax).toBe(900);
    // Grand Total: 18000 + 900 = 18900
    expect(result.grandTotal).toBe(18900);
    // Cost: 2 * 7000 = 14000
    expect(result.totalCostPrice).toBe(14000);
    // Estimated Profit: (18900 - 900) - 14000 = 4000
    expect(result.estimatedProfit).toBe(4000);
  });

  it('handles order-level flat and percent discounts', () => {
    const items: CartItemInput[] = [
      {
        productId: 1,
        unitName: 'Piece',
        quantity: 1,
        conversionFactor: 1,
        unitPrice: 50000, // 500.00
        costPrice: 30000,
        discountPercent: 0,
        discountAmount: 0,
        taxRate: 0,
        isTaxInclusive: false
      }
    ];

    // 10% order discount
    const result = PricingCalculator.calculateSale(items, 10, 0);
    expect(result.subtotal).toBe(50000);
    expect(result.orderDiscountAmount).toBe(5000);
    expect(result.grandTotal).toBe(45000);
  });
});

