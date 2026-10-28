import { describe, it, expect } from 'vitest';
import { Money } from '../../src/domain/money/money';

describe('Domain: Money Arithmetic', () => {
  it('correctly handles integer cents and prevents floating point rounding errors', () => {
    // In IEEE 754 float: 0.1 + 0.2 = 0.30000000000000004
    const m1 = Money.fromDecimal(0.10);
    const m2 = Money.fromDecimal(0.20);
    const sum = m1.add(m2);

    expect(sum.cents).toBe(30);
    expect(sum.decimal).toBe(0.30);
  });

  it('multiplies and calculates percentages accurately', () => {
    const price = Money.fromCents(25000); // 250.00
    const discounted = price.percentage(15); // 15% discount
    expect(discounted.cents).toBe(3750); // 37.50

    const net = price.subtract(discounted);
    expect(net.cents).toBe(21250); // 212.50
  });

  it('formats currency correctly', () => {
    const money = Money.fromCents(123456);
    expect(money.format('Rs. ')).toBe('Rs. 1,234.56');
  });
});

