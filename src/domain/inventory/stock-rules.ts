import { StockMovementType } from '../../shared/constants/accounts';

export interface StockValidationResult {
  isValid: boolean;
  shortage?: number;
  message?: string;
}

export class StockRules {
  /**
   * Validates whether sufficient stock exists for an order deduction.
   */
  public static validateAvailability(
    currentStock: number,
    requestedBaseQty: number,
    allowNegativeStock = false
  ): StockValidationResult {
    if (requestedBaseQty <= 0) {
      return { isValid: false, message: 'Requested quantity must be positive' };
    }

    if (currentStock < requestedBaseQty && !allowNegativeStock) {
      const shortage = Math.round((requestedBaseQty - currentStock) * 1000) / 1000;
      return {
        isValid: false,
        shortage,
        message: `Insufficient stock! In hand: ${currentStock}, Required: ${requestedBaseQty}`
      };
    }

    return { isValid: true };
  }

  /**
   * Computes the new stock balance given a movement type.
   */
  public static computeNewStock(
    currentStock: number,
    type: StockMovementType,
    quantity: number
  ): number {
    if (quantity < 0) {
      throw new Error('Stock movement quantity cannot be negative');
    }

    switch (type) {
      case StockMovementType.SALE:
      case StockMovementType.PURCHASE_RETURN:
      case StockMovementType.ADJUSTMENT_DAMAGE:
      case StockMovementType.ADJUSTMENT_THEFT:
        return Math.round((currentStock - quantity) * 1000) / 1000;

      case StockMovementType.PURCHASE_RECEIPT:
      case StockMovementType.SALE_RETURN:
      case StockMovementType.ADJUSTMENT_ADD:
        return Math.round((currentStock + quantity) * 1000) / 1000;

      case StockMovementType.INITIAL_COUNT:
        return quantity;

      default:
        throw new Error(`Unknown stock movement type: ${type}`);
    }
  }

  /**
   * Checks if an item is below its reorder point.
   */
  public static isLowStock(currentStock: number, minStockLevel: number): boolean {
    return currentStock <= minStockLevel;
  }
}

