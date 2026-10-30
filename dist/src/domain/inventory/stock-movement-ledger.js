"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockMovementRules = exports.MOVEMENT_DIRECTION_MAP = exports.UnitPrecisionOverflowError = exports.LocationArchivedError = exports.ProductArchivedError = exports.UntrackedStockProductError = exports.IdempotencyConflictError = exports.NegativeStockDisallowedError = exports.InvalidQuantityError = exports.InvalidMovementTypeError = void 0;
const crypto_1 = __importDefault(require("crypto"));
class InvalidMovementTypeError extends Error {
    constructor(type) {
        super(`Invalid stock movement type "${type}". Invented movement types are strictly prohibited.`);
        this.name = 'InvalidMovementTypeError';
    }
}
exports.InvalidMovementTypeError = InvalidMovementTypeError;
class InvalidQuantityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidQuantityError';
    }
}
exports.InvalidQuantityError = InvalidQuantityError;
class NegativeStockDisallowedError extends Error {
    constructor(productName, requestedScaled, availableScaled) {
        super(`Insufficient available inventory for "${productName}". Requested: ${requestedScaled / 1000}, Available: ${availableScaled / 1000}. Negative stock is disallowed.`);
        this.name = 'NegativeStockDisallowedError';
    }
}
exports.NegativeStockDisallowedError = NegativeStockDisallowedError;
class IdempotencyConflictError extends Error {
    constructor(key) {
        super(`Idempotency conflict: idempotency key "${key}" was previously posted with different transaction payload data.`);
        this.name = 'IdempotencyConflictError';
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class UntrackedStockProductError extends Error {
    constructor(productName) {
        super(`Cannot post inventory movement for "${productName}" because stock tracking is disabled for this product.`);
        this.name = 'UntrackedStockProductError';
    }
}
exports.UntrackedStockProductError = UntrackedStockProductError;
class ProductArchivedError extends Error {
    constructor(productName) {
        super(`Cannot post outbound stock movement for archived product "${productName}".`);
        this.name = 'ProductArchivedError';
    }
}
exports.ProductArchivedError = ProductArchivedError;
class LocationArchivedError extends Error {
    constructor(locationName) {
        super(`Cannot post stock movement to inactive or archived location "${locationName}".`);
        this.name = 'LocationArchivedError';
    }
}
exports.LocationArchivedError = LocationArchivedError;
class UnitPrecisionOverflowError extends Error {
    constructor(precision, quantity) {
        super(`Quantity ${quantity} exceeds the configured decimal precision of ${precision} for this measurement unit.`);
        this.name = 'UnitPrecisionOverflowError';
    }
}
exports.UnitPrecisionOverflowError = UnitPrecisionOverflowError;
exports.MOVEMENT_DIRECTION_MAP = {
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
class StockMovementRules {
    /**
     * Resolves the authoritative movement direction ('IN' or 'OUT').
     * Rejects any unrecognized or custom movement types.
     */
    static getDirection(type) {
        const dir = exports.MOVEMENT_DIRECTION_MAP[type];
        if (!dir) {
            throw new InvalidMovementTypeError(type);
        }
        return dir;
    }
    /**
     * Validates that quantity is a strictly positive integer magnitude in scaled units.
     */
    static validateQuantityMagnitude(quantityScaled) {
        if (typeof quantityScaled !== 'number' || isNaN(quantityScaled)) {
            throw new InvalidQuantityError('Movement quantity must be a valid number.');
        }
        if (quantityScaled === 0) {
            throw new InvalidQuantityError('Movement quantity cannot be zero.');
        }
        if (quantityScaled < 0) {
            throw new InvalidQuantityError(`Movement quantity must be a positive magnitude (received ${quantityScaled}). Direction is determined solely by movement type.`);
        }
        if (!Number.isInteger(quantityScaled)) {
            throw new InvalidQuantityError(`Quantity scaled must be an integer (received ${quantityScaled}).`);
        }
    }
    /**
     * Checks whether the fractional quantity satisfies the measurement unit precision scale.
     */
    static validateUnitPrecision(quantityScaled, decimalPrecision) {
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
    static calculateAvailableStock(onHandScaled, reservedScaled) {
        return Math.max(0, onHandScaled - reservedScaled);
    }
    /**
     * Validates stock availability for outbound movements.
     */
    static validateAvailability(productName, onHandScaled, reservedScaled, requestedScaled, allowNegativeStock) {
        const available = onHandScaled - reservedScaled;
        if (available < requestedScaled && !allowNegativeStock) {
            throw new NegativeStockDisallowedError(productName, requestedScaled, available);
        }
    }
    /**
     * Computes a deterministic SHA-256 payload hash to distinguish idempotent re-execution from conflicting data.
     */
    static computePayloadHash(input) {
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
        return crypto_1.default.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    }
}
exports.StockMovementRules = StockMovementRules;
