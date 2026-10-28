import { describe, it, expect } from 'vitest';
import { StockRules } from '../../src/domain/inventory/stock-rules';
import { StockMovementType } from '../../src/shared/constants/accounts';

describe('Domain: StockRules', () => {
  it('validates stock availability correctly', () => {
    // Current stock: 5, requested: 3 -> valid
    const res1 = StockRules.validateAvailability(5, 3);
    expect(res1.isValid).toBe(true);

    // Current stock: 2, requested: 5 -> invalid shortage 3
    const res2 = StockRules.validateAvailability(2, 5);
    expect(res2.isValid).toBe(false);
    expect(res2.shortage).toBe(3);
  });

  it('computes new stock balance after different movement types', () => {
    expect(StockRules.computeNewStock(10, StockMovementType.SALE, 3)).toBe(7);
    expect(StockRules.computeNewStock(10, StockMovementType.PURCHASE_RECEIPT, 5)).toBe(15);
    expect(StockRules.computeNewStock(10, StockMovementType.ADJUSTMENT_DAMAGE, 2)).toBe(8);
  });

  it('identifies low stock thresholds', () => {
    expect(StockRules.isLowStock(3, 5)).toBe(true);
    expect(StockRules.isLowStock(5, 5)).toBe(true);
    expect(StockRules.isLowStock(6, 5)).toBe(false);
  });
});

