/**
 * Domain: Scaled Quantity
 * Fixed-point quantity model for inventory and sales.
 * QUANTITY_SCALE = 10_000 represents 1/10,000th of a canonical base unit.
 *
 * Examples:
 *   1 piece     = 10,000 scaled units
 *   1.5 kg      = 15,000 scaled kg units
 *   0.250 kg    = 2,500 scaled kg units
 *   2.75 litres = 27,500 scaled litre units
 *
 * Quantities that exceed the allowed precision or cannot be represented
 * exactly are REJECTED with an explicit error instead of being silently rounded.
 */

export const QUANTITY_SCALE = 10_000;
export const MAX_QUANTITY_DECIMALS = 4;

export class InvalidQuantityPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityPrecisionError';
  }
}

/**
 * Counts the number of decimal places in a number.
 */
export function getDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.floor(value) === value) return 0;

  const str = value.toString();
  // Handle exponential notation if any (e.g. 1e-5)
  if (str.includes('e-')) {
    const parts = str.split('e-');
    return parseInt(parts[1], 10);
  }
  const decimalPart = str.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
}

/**
 * Validates that a quantity conforms strictly to the specified precision scale.
 * If precisionScale is 0 (e.g. Piece), fractional values are strictly rejected.
 * No value may exceed the scale limit of 4 decimal places.
 */
export function validateQuantityPrecision(quantity: number, precisionScale = MAX_QUANTITY_DECIMALS): void {
  if (!Number.isFinite(quantity)) {
    throw new InvalidQuantityPrecisionError(`Invalid quantity: ${quantity} is not a finite number.`);
  }

  const effectiveAllowedScale = Math.min(precisionScale, MAX_QUANTITY_DECIMALS);
  const decimals = getDecimalPlaces(quantity);

  if (decimals > effectiveAllowedScale) {
    throw new InvalidQuantityPrecisionError(
      `Quantity ${quantity} has ${decimals} decimal places, exceeding the allowed precision scale of ${effectiveAllowedScale} (unit precision: ${precisionScale}, max scale: ${MAX_QUANTITY_DECIMALS}). Quiet rounding is prohibited.`
    );
  }
}

/**
 * Converts a human-readable decimal quantity into an exact fixed-point scaled integer.
 * Throws InvalidQuantityPrecisionError if the value exceeds permitted precision or scale limits.
 */
export function toScaledQuantity(quantity: number, precisionScale?: number): number {
  if (precisionScale !== undefined) {
    validateQuantityPrecision(quantity, precisionScale);
  } else {
    validateQuantityPrecision(quantity, MAX_QUANTITY_DECIMALS);
  }

  const rawScaled = quantity * QUANTITY_SCALE;
  const rounded = Math.round(rawScaled);

  // Check for fractional scaled units (more than 4 decimal places)
  if (Math.abs(rawScaled - rounded) > 1e-5) {
    throw new InvalidQuantityPrecisionError(
      `Quantity ${quantity} cannot be represented exactly in QUANTITY_SCALE ${QUANTITY_SCALE}. Quiet rounding is prohibited.`
    );
  }

  return rounded;
}

/**
 * Converts an authoritative fixed-point scaled integer back to a decimal quantity.
 */
export function fromScaledQuantity(scaledQuantity: number): number {
  if (!Number.isInteger(scaledQuantity)) {
    throw new InvalidQuantityPrecisionError(`Scaled quantity ${scaledQuantity} must be an integer.`);
  }
  return scaledQuantity / QUANTITY_SCALE;
}

/**
 * Adds two scaled quantities.
 */
export function addScaled(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts two scaled quantities.
 */
export function subtractScaled(a: number, b: number): number {
  return a - b;
}

/**
 * Multiplies a scaled quantity by an integer factor.
 */
export function multiplyScaledByInteger(scaledQty: number, factor: number): number {
  if (!Number.isInteger(factor)) {
    throw new InvalidQuantityPrecisionError(`Multiplication factor ${factor} must be an integer.`);
  }
  return scaledQty * factor;
}

/**
 * Scales an integer count of pieces (e.g. 10 pieces -> 100,000 scaled units).
 */
export function scaleIntegerPieces(pieces: number): number {
  if (!Number.isInteger(pieces)) {
    throw new InvalidQuantityPrecisionError(`Pieces count ${pieces} must be an integer.`);
  }
  return pieces * QUANTITY_SCALE;
}

