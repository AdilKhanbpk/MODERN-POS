"use strict";
/**
 * Domain: Units & Conversion
 * Re-exports scalable quantity and rational conversion tools.
 * Provides backward-compatible UnitConverter helper.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnitConverter = void 0;
__exportStar(require("./scaled-quantity"), exports);
__exportStar(require("./rational-conversion"), exports);
class UnitConverter {
    /**
     * Converts a quantity in a specific packaging unit into standard base units.
     */
    static toBaseQuantity(quantity, conversionFactor) {
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
    static fromBaseQuantity(baseQuantity, conversionFactor) {
        if (conversionFactor <= 0) {
            throw new Error('Conversion factor must be greater than zero');
        }
        return Math.round((baseQuantity / conversionFactor) * 10000) / 10000;
    }
    /**
     * Calculates the unit cost or price for a converted packaging unit.
     */
    static calculatePackPrice(basePriceCents, conversionFactor) {
        return Math.round(basePriceCents * conversionFactor);
    }
}
exports.UnitConverter = UnitConverter;
