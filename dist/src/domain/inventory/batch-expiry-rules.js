"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchExpiryRules = exports.BatchNotFoundError = exports.BatchAuthorizationRequiredError = exports.InsufficientBatchStockError = exports.BatchQuarantinedError = exports.BatchRecalledError = exports.BatchExpiredSaleBlockedError = exports.DuplicateBatchNumberError = exports.InvalidManufacturingDateError = exports.ExpiryDateRequiredError = exports.BatchRequiredError = exports.BatchError = void 0;
const batch_expiry_math_1 = require("./batch-expiry-math");
// Custom Domain Exceptions
class BatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BatchError';
    }
}
exports.BatchError = BatchError;
class BatchRequiredError extends BatchError {
    constructor(productName) {
        super(`Product "${productName}" is batch-controlled and requires a valid batch number.`);
        this.name = 'BatchRequiredError';
    }
}
exports.BatchRequiredError = BatchRequiredError;
class ExpiryDateRequiredError extends BatchError {
    constructor(batchNumber) {
        super(`Batch "${batchNumber}" requires an expiry date under the configured product policy.`);
        this.name = 'ExpiryDateRequiredError';
    }
}
exports.ExpiryDateRequiredError = ExpiryDateRequiredError;
class InvalidManufacturingDateError extends BatchError {
    constructor(message) {
        super(message);
        this.name = 'InvalidManufacturingDateError';
    }
}
exports.InvalidManufacturingDateError = InvalidManufacturingDateError;
class DuplicateBatchNumberError extends BatchError {
    constructor(batchNumber, productName) {
        super(`Batch number "${batchNumber}" already exists for product "${productName}". Duplicate batch records for the same product are prohibited.`);
        this.name = 'DuplicateBatchNumberError';
    }
}
exports.DuplicateBatchNumberError = DuplicateBatchNumberError;
class BatchExpiredSaleBlockedError extends BatchError {
    constructor(batchNumber, expiryDate, daysRemaining) {
        const timePhrase = daysRemaining < 0
            ? `expired ${Math.abs(daysRemaining)} day(s) ago on ${expiryDate}`
            : `expires today on ${expiryDate}`;
        super(`Cannot sell batch "${batchNumber}": Batch ${timePhrase} and is blocked by policy.`);
        this.name = 'BatchExpiredSaleBlockedError';
    }
}
exports.BatchExpiredSaleBlockedError = BatchExpiredSaleBlockedError;
class BatchRecalledError extends BatchError {
    constructor(batchNumber) {
        super(`Batch "${batchNumber}" has been RECALLED. All sales and distribution from this batch are strictly prohibited.`);
        this.name = 'BatchRecalledError';
    }
}
exports.BatchRecalledError = BatchRecalledError;
class BatchQuarantinedError extends BatchError {
    constructor(batchNumber) {
        super(`Batch "${batchNumber}" is currently in QUARANTINE and cannot be sold or transferred without inspection clearance.`);
        this.name = 'BatchQuarantinedError';
    }
}
exports.BatchQuarantinedError = BatchQuarantinedError;
class InsufficientBatchStockError extends BatchError {
    constructor(batchNumber, requestedQty, availableQty) {
        super(`Insufficient available stock in batch "${batchNumber}". Requested: ${requestedQty}, Available: ${availableQty}.`);
        this.name = 'InsufficientBatchStockError';
    }
}
exports.InsufficientBatchStockError = InsufficientBatchStockError;
class BatchAuthorizationRequiredError extends BatchError {
    constructor(batchNumber, reason) {
        super(`Sale of batch "${batchNumber}" requires manager authorization: ${reason}.`);
        this.name = 'BatchAuthorizationRequiredError';
    }
}
exports.BatchAuthorizationRequiredError = BatchAuthorizationRequiredError;
class BatchNotFoundError extends BatchError {
    constructor(batchId) {
        super(`Batch with identifier "${batchId}" was not found.`);
        this.name = 'BatchNotFoundError';
    }
}
exports.BatchNotFoundError = BatchNotFoundError;
class BatchExpiryRules {
    /**
     * Validates inbound batch receipt data against product batch settings.
     */
    static validateBatchReceipt(dto, settings) {
        if (dto.quantityScaled <= 0) {
            throw new BatchError(`Receipt quantity must be greater than zero. Received: ${dto.quantityScaled / 1000}`);
        }
        if (!dto.batchNumber || !dto.batchNumber.trim()) {
            if (settings?.requiresBatch) {
                throw new BatchRequiredError('Unknown Product');
            }
            throw new BatchError('Batch number cannot be empty.');
        }
        // Require expiry date if product setting mandates it
        if (settings?.requiresExpiry) {
            if (!dto.expiryDate || !dto.expiryDate.trim()) {
                throw new ExpiryDateRequiredError(dto.batchNumber.trim());
            }
        }
        // Validate manufacturing date if present
        if (dto.manufacturingDate && dto.manufacturingDate.trim()) {
            const mfgUtc = batch_expiry_math_1.BatchExpiryMath.parseDateUtc(dto.manufacturingDate.slice(0, 10));
            const now = new Date();
            const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
            if (mfgUtc.getTime() > todayUtc.getTime()) {
                throw new InvalidManufacturingDateError(`Manufacturing date (${dto.manufacturingDate}) cannot be in the future.`);
            }
            if (dto.expiryDate && dto.expiryDate.trim()) {
                const expUtc = batch_expiry_math_1.BatchExpiryMath.parseDateUtc(dto.expiryDate.slice(0, 10));
                if (mfgUtc.getTime() >= expUtc.getTime()) {
                    throw new InvalidManufacturingDateError(`Manufacturing date (${dto.manufacturingDate}) cannot be equal to or after the expiry date (${dto.expiryDate}).`);
                }
            }
        }
        // Validate expiry date if present
        if (dto.expiryDate && dto.expiryDate.trim()) {
            const expiryResult = batch_expiry_math_1.BatchExpiryMath.calculateDaysUntilExpiry(dto.expiryDate);
            if (expiryResult.isExpired) {
                throw new BatchError(`Cannot receive batch "${dto.batchNumber}": The stock is already expired (expired on ${expiryResult.formattedExpiryDate}).`);
            }
        }
    }
    /**
     * Validates whether a batch is eligible for sale under the product's expiry sale policy.
     */
    static validateSaleBatchEligibility(batch, settings, referenceDate, isAuthorized = false) {
        // 1. Status checks
        if (batch.status === 'recalled') {
            throw new BatchRecalledError(batch.batchNumber);
        }
        if (batch.status === 'quarantine') {
            throw new BatchQuarantinedError(batch.batchNumber);
        }
        if (batch.status === 'closed') {
            throw new BatchError(`Batch "${batch.batchNumber}" is closed and cannot be sold.`);
        }
        // 2. Expiry date policy checks
        const expiryDate = batch.expiryDate;
        if (expiryDate) {
            const expiryInfo = batch_expiry_math_1.BatchExpiryMath.calculateDaysUntilExpiry(expiryDate, settings?.expiryWarningDays || 30, referenceDate);
            const policy = settings?.expirySalePolicy || 'block';
            // Past expiry date: strictly blocked
            if (expiryInfo.isExpired) {
                if (policy === 'allow_authorized' && isAuthorized) {
                    return {
                        isAllowed: true,
                        warning: `Batch "${batch.batchNumber}" expired on ${expiryInfo.formattedExpiryDate} (sold under manager authorization).`
                    };
                }
                throw new BatchExpiredSaleBlockedError(batch.batchNumber, expiryInfo.formattedExpiryDate, expiryInfo.daysRemaining);
            }
            // Expiring today
            if (expiryInfo.isExpiringToday) {
                if (policy === 'block') {
                    throw new BatchExpiredSaleBlockedError(batch.batchNumber, expiryInfo.formattedExpiryDate, 0);
                }
                if (policy === 'allow_authorized') {
                    if (!isAuthorized) {
                        throw new BatchAuthorizationRequiredError(batch.batchNumber, `Batch expires today (${expiryInfo.formattedExpiryDate})`);
                    }
                    return {
                        isAllowed: true,
                        warning: `Batch "${batch.batchNumber}" expires today (sold under manager authorization).`
                    };
                }
                if (policy === 'warn') {
                    return {
                        isAllowed: true,
                        warning: `Notice: Batch "${batch.batchNumber}" expires today (${expiryInfo.formattedExpiryDate}).`
                    };
                }
            }
            // Expiring soon (warning period)
            if (expiryInfo.isExpiringSoon) {
                return {
                    isAllowed: true,
                    warning: `Batch "${batch.batchNumber}" is near expiry (${expiryInfo.daysRemaining} days remaining, expires ${expiryInfo.formattedExpiryDate}).`
                };
            }
        }
        return { isAllowed: true };
    }
}
exports.BatchExpiryRules = BatchExpiryRules;
