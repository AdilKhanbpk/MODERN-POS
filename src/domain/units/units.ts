/**
 * Domain: Units & Conversion
 * Re-exports scalable quantity and rational conversion tools.
 * Provides backward-compatible UnitConverter helper.
 */

export * from './scaled-quantity';
export * from './rational-conversion';

import { RationalConverter } from './rational-conversion';

export class UnitConverter {
  /**
   * Converts a quantity in a specific packaging unit into standard base units.
   */
  public static toBaseQuantity(quantity: number, conversionFactor: number): number {
    if (quantity < 0) {
      throw new Error('Quantity cannot be negative');
    }
    if (conversionFactor <= 0) {
      throw new Error('Conversion factor must be greater than zero');
    }
    return Math.round(quantity * conversionFactor * 10000) / 10000;
  }

  /**
   * Converts a base unit quantity into a packaging unit.
   */
  public static fromBaseQuantity(baseQuantity: number, conversionFactor: number): number {
    if (conversionFactor <= 0) {
      throw new Error('Conversion factor must be greater than zero');
    }
    return Math.round((baseQuantity / conversionFactor) * 10000) / 10000;
  }

  /**
   * Calculates the unit cost or price for a converted packaging unit.
   */
  public static calculatePackPrice(basePriceCents: number, conversionFactor: number): number {
    return Math.round(basePriceCents * conversionFactor);
  }
}
