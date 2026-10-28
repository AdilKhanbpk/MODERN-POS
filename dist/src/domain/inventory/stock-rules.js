"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockRules = void 0;
const accounts_1 = require("../../shared/constants/accounts");
class StockRules {
    /**
     * Validates whether sufficient stock exists for an order deduction.
     */
    static validateAvailability(currentStock, requestedBaseQty, allowNegativeStock = false) {
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
    static computeNewStock(currentStock, type, quantity) {
        if (quantity < 0) {
            throw new Error('Stock movement quantity cannot be negative');
        }
        switch (type) {
            case accounts_1.StockMovementType.SALE:
            case accounts_1.StockMovementType.PURCHASE_RETURN:
            case accounts_1.StockMovementType.ADJUSTMENT_DAMAGE:
            case accounts_1.StockMovementType.ADJUSTMENT_THEFT:
                return Math.round((currentStock - quantity) * 1000) / 1000;
            case accounts_1.StockMovementType.PURCHASE_RECEIPT:
            case accounts_1.StockMovementType.SALE_RETURN:
            case accounts_1.StockMovementType.ADJUSTMENT_ADD:
                return Math.round((currentStock + quantity) * 1000) / 1000;
            case accounts_1.StockMovementType.INITIAL_COUNT:
                return quantity;
            default:
                throw new Error(`Unknown stock movement type: ${type}`);
        }
    }
    /**
     * Checks if an item is below its reorder point.
     */
    static isLowStock(currentStock, minStockLevel) {
        return currentStock <= minStockLevel;
    }
}
exports.StockRules = StockRules;
