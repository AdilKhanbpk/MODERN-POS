"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidQuantityPrecisionError = exports.MAX_QUANTITY_DECIMALS = exports.QUANTITY_SCALE = void 0;
exports.getDecimalPlaces = getDecimalPlaces;
exports.validateQuantityPrecision = validateQuantityPrecision;
exports.toScaledQuantity = toScaledQuantity;
exports.fromScaledQuantity = fromScaledQuantity;
exports.addScaled = addScaled;
exports.subtractScaled = subtractScaled;
exports.multiplyScaledByInteger = multiplyScaledByInteger;
exports.scaleIntegerPieces = scaleIntegerPieces;
exports.QUANTITY_SCALE = 10_000;
exports.MAX_QUANTITY_DECIMALS = 4;
class InvalidQuantityPrecisionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidQuantityPrecisionError';
    }
}
exports.InvalidQuantityPrecisionError = InvalidQuantityPrecisionError;
/**
 * Counts the number of decimal places in a number.
 */
function getDecimalPlaces(value) {
    if (!Number.isFinite(value))
        return 0;
    if (Math.floor(value) === value)
        return 0;
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
function validateQuantityPrecision(quantity, precisionScale = exports.MAX_QUANTITY_DECIMALS) {
    if (!Number.isFinite(quantity)) {
        throw new InvalidQuantityPrecisionError(`Invalid quantity: ${quantity} is not a finite number.`);
    }
    const effectiveAllowedScale = Math.min(precisionScale, exports.MAX_QUANTITY_DECIMALS);
    const decimals = getDecimalPlaces(quantity);
    if (decimals > effectiveAllowedScale) {
        throw new InvalidQuantityPrecisionError(`Quantity ${quantity} has ${decimals} decimal places, exceeding the allowed precision scale of ${effectiveAllowedScale} (unit precision: ${precisionScale}, max scale: ${exports.MAX_QUANTITY_DECIMALS}). Quiet rounding is prohibited.`);
    }
}
/**
 * Converts a human-readable decimal quantity into an exact fixed-point scaled integer.
 * Throws InvalidQuantityPrecisionError if the value exceeds permitted precision or scale limits.
 */
function toScaledQuantity(quantity, precisionScale) {
    if (precisionScale !== undefined) {
        validateQuantityPrecision(quantity, precisionScale);
    }
    else {
        validateQuantityPrecision(quantity, exports.MAX_QUANTITY_DECIMALS);
    }
    const rawScaled = quantity * exports.QUANTITY_SCALE;
    const rounded = Math.round(rawScaled);
    // Check for fractional scaled units (more than 4 decimal places)
    if (Math.abs(rawScaled - rounded) > 1e-5) {
        throw new InvalidQuantityPrecisionError(`Quantity ${quantity} cannot be represented exactly in QUANTITY_SCALE ${exports.QUANTITY_SCALE}. Quiet rounding is prohibited.`);
    }
    return rounded;
}
/**
 * Converts an authoritative fixed-point scaled integer back to a decimal quantity.
 */
function fromScaledQuantity(scaledQuantity) {
    if (!Number.isInteger(scaledQuantity)) {
        throw new InvalidQuantityPrecisionError(`Scaled quantity ${scaledQuantity} must be an integer.`);
    }
    return scaledQuantity / exports.QUANTITY_SCALE;
}
/**
 * Adds two scaled quantities.
 */
function addScaled(a, b) {
    return a + b;
}
/**
 * Subtracts two scaled quantities.
 */
function subtractScaled(a, b) {
    return a - b;
}
/**
 * Multiplies a scaled quantity by an integer factor.
 */
function multiplyScaledByInteger(scaledQty, factor) {
    if (!Number.isInteger(factor)) {
        throw new InvalidQuantityPrecisionError(`Multiplication factor ${factor} must be an integer.`);
    }
    return scaledQty * factor;
}
/**
 * Scales an integer count of pieces (e.g. 10 pieces -> 100,000 scaled units).
 */
function scaleIntegerPieces(pieces) {
    if (!Number.isInteger(pieces)) {
        throw new InvalidQuantityPrecisionError(`Pieces count ${pieces} must be an integer.`);
    }
    return pieces * exports.QUANTITY_SCALE;
}
