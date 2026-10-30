import crypto from 'crypto';
import {
  StockMovementType,
  StockMovementDirection,
  PostStockMovementInput
} from '../../shared/types/stock-movement';

export class InvalidMovementTypeError extends Error {
  constructor(type: string) {
    super(`Invalid stock movement type "${type}". Invented movement types are strictly prohibited.`);
    this.name = 'InvalidMovementTypeError';
  }
}

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

export class NegativeStockDisallowedError extends Error {
  constructor(productName: string, requestedScaled: number, availableScaled: number) {
    super(
      `Insufficient available inventory for "${productName}". Requested: ${requestedScaled / 1000}, Available: ${availableScaled / 1000}. Negative stock is disallowed.`
    );
    this.name = 'NegativeStockDisallowedError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency conflict: idempotency key "${key}" was previously posted with different transaction payload data.`);
    this.name = 'IdempotencyConflictError';
  }
}

export class UntrackedStockProductError extends Error {
  constructor(productName: string) {
    super(`Cannot post inventory movement for "${productName}" because stock tracking is disabled for this product.`);
    this.name = 'UntrackedStockProductError';
  }
}

export class ProductArchivedError extends Error {
  constructor(productName: string) {
    super(`Cannot post outbound stock movement for archived product "${productName}".`);
    this.name = 'ProductArchivedError';
  }
}

export class LocationArchivedError extends Error {
  constructor(locationName: string) {
    super(`Cannot post stock movement to inactive or archived location "${locationName}".`);
    this.name = 'LocationArchivedError';
  }
}

export class UnitPrecisionOverflowError extends Error {
  constructor(precision: number, quantity: number) {
    super(`Quantity ${quantity} exceeds the configured decimal precision of ${precision} for this measurement unit.`);
    this.name = 'UnitPrecisionOverflowError';
  }
}

export const MOVEMENT_DIRECTION_MAP: Record<StockMovementType, StockMovementDirection> = {
  PURCHASE_RECEIPT: 'IN',
  CUSTOMER_RETURN: 'IN',
  ADJUSTMENT_INCREASE: 'IN',
  SALE: 'OUT',
  SUPPLIER_RETURN: 'OUT',
  DAMAGE_WRITEOFF: 'OUT',
  ADJUSTMENT_DECREASE: 'OUT',
  TRANSFER_OUT: 'OUT',
  TRANSFER_IN: 'IN',
  TRANSFER_DISPATCH: 'OUT',
  TRANSFER_RECEIPT: 'IN',
  TRANSFER_REJECTED: 'IN',
  TRANSFER_LOSS: 'OUT',
  STOCKTAKE_SURPLUS: 'IN',
  STOCKTAKE_DEFICIT: 'OUT',
  OPENING_STOCK: 'IN'
};

export class StockMovementRules {
  /**
   * Resolves the authoritative movement direction ('IN' or 'OUT').
   * Rejects any unrecognized or custom movement types.
   */
  public static getDirection(type: string): StockMovementDirection {
    const dir = (MOVEMENT_DIRECTION_MAP as any)[type];
    if (!dir) {
      throw new InvalidMovementTypeError(type);
    }
    return dir;
  }

  /**
   * Validates that quantity is a strictly positive integer magnitude in scaled units.
   */
  public static validateQuantityMagnitude(quantityScaled: number): void {
    if (typeof quantityScaled !== 'number' || isNaN(quantityScaled)) {
      throw new InvalidQuantityError('Movement quantity must be a valid number.');
    }
    if (quantityScaled === 0) {
      throw new InvalidQuantityError('Movement quantity cannot be zero.');
    }
    if (quantityScaled < 0) {
      throw new InvalidQuantityError(
        `Movement quantity must be a positive magnitude (received ${quantityScaled}). Direction is determined solely by movement type.`
      );
    }
    if (!Number.isInteger(quantityScaled)) {
      throw new InvalidQuantityError(`Quantity scaled must be an integer (received ${quantityScaled}).`);
    }
  }

  /**
   * Checks whether the fractional quantity satisfies the measurement unit precision scale.
   */
  public static validateUnitPrecision(quantityScaled: number, decimalPrecision: number): void {
    // scale factor is 1000 (3 decimals)
    if (decimalPrecision === 0 && quantityScaled % 1000 !== 0) {
      throw new UnitPrecisionOverflowError(decimalPrecision, quantityScaled / 1000);
    }
    if (decimalPrecision === 1 && quantityScaled % 100 !== 0) {
      throw new UnitPrecisionOverflowError(decimalPrecision, quantityScaled / 1000);
    }
    if (decimalPrecision === 2 && quantityScaled % 10 !== 0) {
      throw new UnitPrecisionOverflowError(decimalPrecision, quantityScaled / 1000);
    }
  }

  /**
   * Computes available stock: Available = OnHand - Reserved
   */
  public static calculateAvailableStock(onHandScaled: number, reservedScaled: number): number {
    return Math.max(0, onHandScaled - reservedScaled);
  }

  /**
   * Validates stock availability for outbound movements.
   */
  public static validateAvailability(
    productName: string,
    onHandScaled: number,
    reservedScaled: number,
    requestedScaled: number,
    allowNegativeStock: boolean
  ): void {
    const available = onHandScaled - reservedScaled;
    if (available < requestedScaled && !allowNegativeStock) {
      throw new NegativeStockDisallowedError(productName, requestedScaled, available);
    }
  }

  /**
   * Computes a deterministic SHA-256 payload hash to distinguish idempotent re-execution from conflicting data.
   */
  public static computePayloadHash(input: PostStockMovementInput): string {
    const normalized = {
      businessId: input.businessId,
      branchId: input.branchId,
      productId: String(input.productId),
      variantId: input.variantId ? String(input.variantId) : null,
      stockLocationId: input.stockLocationId,
      batchId: input.batchId ? String(input.batchId) : null,
      serialNumberId: input.serialNumberId ? String(input.serialNumberId) : null,
      movementType: input.movementType,
      quantityScaled: input.quantityScaled,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceLineId: input.referenceLineId || null
    };

    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }
}

