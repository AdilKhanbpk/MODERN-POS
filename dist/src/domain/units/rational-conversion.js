"use strict";
/**
 * Domain: Rational Unit Conversion
 * Handles multi-unit sales, purchases, and stock ledger movements using exact rational numbers
 * (numerator / denominator) to prevent floating-point inaccuracies.
 *
 * Examples:
 *   Dozen:        numerator = 12, denominator = 1
 *   Gross:        numerator = 144, denominator = 1
 *   Shampoo Pack: numerator = 6, denominator = 1 (Product-specific)
 *   Juice Pack:   numerator = 12, denominator = 1 (Product-specific)
 *   Kg to Gram:   numerator = 1000, denominator = 1 (when base unit is gram)
 *   Gram to Kg:   numerator = 1, denominator = 1000 (when base unit is kg)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RationalConverter = exports.UnitConversionError = void 0;
const scaled_quantity_1 = require("./scaled-quantity");
class UnitConversionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnitConversionError';
    }
}
exports.UnitConversionError = UnitConversionError;
class RationalConverter {
    /**
     * Validates that the numerator and denominator form a valid positive rational factor.
     */
    static validateRule(rule) {
        if (!Number.isInteger(rule.baseUnitsNumerator) || rule.baseUnitsNumerator <= 0) {
            throw new UnitConversionError(`Invalid numerator: ${rule.baseUnitsNumerator}. Must be a positive integer.`);
        }
        if (!Number.isInteger(rule.baseUnitsDenominator) || rule.baseUnitsDenominator <= 0) {
            throw new UnitConversionError(`Invalid denominator: ${rule.baseUnitsDenominator}. Must be a positive integer.`);
        }
    }
    /**
     * Converts a quantity in packaging/display units to CANONICAL BASE QUANTITY (scaled by QUANTITY_SCALE).
     *
     * Formula:
     *   Base Quantity = (Quantity * baseUnitsNumerator) / baseUnitsDenominator
     *   Base Quantity Scaled = (QuantityScaled * baseUnitsNumerator) / baseUnitsDenominator
     *
     * If the conversion results in an unrepresentable fraction (inexact scaled quantity),
     * an error is thrown instead of silently rounding.
     */
    static toBaseQuantityScaled(packageQuantity, rule, unitPrecisionScale) {
        this.validateRule(rule);
        if (packageQuantity < 0) {
            throw new UnitConversionError(`Quantity cannot be negative: ${packageQuantity}`);
        }
        // First validate packaging quantity against unit precision scale
        if (unitPrecisionScale !== undefined) {
            (0, scaled_quantity_1.validateQuantityPrecision)(packageQuantity, unitPrecisionScale);
        }
        const packageQtyScaled = (0, scaled_quantity_1.toScaledQuantity)(packageQuantity, unitPrecisionScale);
        // Exact rational multiplication
        const numeratorScaled = packageQtyScaled * rule.baseUnitsNumerator;
        const remainder = numeratorScaled % rule.baseUnitsDenominator;
        if (remainder !== 0) {
            throw new UnitConversionError(`Quantity ${packageQuantity} converted with ratio (${rule.baseUnitsNumerator}/${rule.baseUnitsDenominator}) ` +
                `yields a fractional remainder of ${remainder}/${rule.baseUnitsDenominator} scaled units. ` +
                `Exact representation is impossible; quiet rounding is prohibited.`);
        }
        return numeratorScaled / rule.baseUnitsDenominator;
    }
    /**
     * Converts a canonical base quantity (scaled by QUANTITY_SCALE) back to a packaging unit quantity.
     */
    static fromBaseQuantityScaled(baseQuantityScaled, rule, targetUnitPrecisionScale) {
        this.validateRule(rule);
        if (baseQuantityScaled < 0) {
            throw new UnitConversionError(`Base quantity cannot be negative: ${baseQuantityScaled}`);
        }
        // Multiply by denominator then divide by numerator
        const num = baseQuantityScaled * rule.baseUnitsDenominator;
        const remainder = num % rule.baseUnitsNumerator;
        if (remainder !== 0) {
            throw new UnitConversionError(`Base quantity scaled ${baseQuantityScaled} cannot be converted exactly to unit with ratio ` +
                `(${rule.baseUnitsNumerator}/${rule.baseUnitsDenominator}). Exact representation is impossible; quiet rounding is prohibited.`);
        }
        const convertedScaled = num / rule.baseUnitsNumerator;
        const decimal = (0, scaled_quantity_1.fromScaledQuantity)(convertedScaled);
        if (targetUnitPrecisionScale !== undefined) {
            (0, scaled_quantity_1.validateQuantityPrecision)(decimal, targetUnitPrecisionScale);
        }
        return decimal;
    }
    /**
     * Converts a base unit price (in integer minor units / paisa) to a packaging unit price.
     *
     * Formula:
     *   Package Price = (Base Price * baseUnitsNumerator) / baseUnitsDenominator
     *
     * E.g. Base piece cost = 2,000 paisa (Rs 20.00).
     * 1 dozen (num = 12, den = 1) -> 2,000 * 12 / 1 = 24,000 paisa (Rs 240.00).
     */
    static calculatePackagePriceMinor(basePriceMinor, rule) {
        this.validateRule(rule);
        const raw = (basePriceMinor * rule.baseUnitsNumerator) / rule.baseUnitsDenominator;
        return Math.round(raw);
    }
    /**
     * Converts a packaging purchase price (in integer minor units / paisa) down to a single canonical base unit cost.
     *
     * Formula:
     *   Base Unit Cost = (Package Price * baseUnitsDenominator) / baseUnitsNumerator
     *
     * E.g. 1 dozen purchased @ Rs 240.00 (24,000 paisa), num = 12, den = 1:
     *   Base Cost = (24,000 * 1) / 12 = 2,000 paisa (Rs 20.00 / piece).
     */
    static calculateBaseCostMinor(packageCostMinor, rule) {
        this.validateRule(rule);
        const raw = (packageCostMinor * rule.baseUnitsDenominator) / rule.baseUnitsNumerator;
        return Math.round(raw);
    }
    /**
     * Calculates COGS and Gross Profit for a sale line given package quantity, package selling price,
     * base unit cost, and the rational conversion rule.
     *
     * Example from specifications:
     *   Purchase: 1 dozen @ Rs 240.00 -> Base unit cost = Rs 20.00 (2,000 paisa)
     *   Sale: 3 pieces @ Rs 25.00 (2,500 paisa)
     *   Sale total = 3 * 2,500 = 7,500 paisa (Rs 75.00)
     *   COGS = 3 * 2,000 = 6,000 paisa (Rs 60.00)
     *   Gross profit = 7,500 - 6,000 = 1,500 paisa (Rs 15.00)
     */
    static calculateSaleLineMargin(params) {
        const baseQuantityScaled = this.toBaseQuantityScaled(params.quantity, params.rule, params.unitPrecisionScale);
        const lineGrossMinor = Math.round(params.quantity * params.unitPriceMinor);
        const baseQuantityDecimal = (0, scaled_quantity_1.fromScaledQuantity)(baseQuantityScaled);
        const lineCostMinor = Math.round(baseQuantityDecimal * params.baseCostMinor);
        const grossProfitMinor = lineGrossMinor - lineCostMinor;
        return {
            baseQuantityScaled,
            lineGrossMinor,
            lineCostMinor,
            grossProfitMinor
        };
    }
}
exports.RationalConverter = RationalConverter;
