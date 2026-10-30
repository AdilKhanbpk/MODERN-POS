"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialRules = exports.UnauthorizedReturnError = exports.WarrantyExpiredError = exports.ManualSerialEntryNotAllowedError = exports.InvalidSerialStatusTransitionError = exports.SerialLocationMismatchError = exports.SerialProductMismatchError = exports.SerialAlreadySoldError = exports.SerialNotAvailableError = exports.SerialNotFoundError = exports.DuplicateImeiError = exports.DuplicateSerialNumberError = exports.SerialCountMismatchError = exports.SerialRequiredError = void 0;
const serial_math_1 = require("./serial-math");
class SerialRequiredError extends Error {
    constructor(productName) {
        super(`Product '${productName}' requires serial number tracking. Serial number must be specified.`);
        this.name = 'SerialRequiredError';
    }
}
exports.SerialRequiredError = SerialRequiredError;
class SerialCountMismatchError extends Error {
    constructor(productName, expectedCount, actualCount) {
        super(`Serial count mismatch for '${productName}': expected ${expectedCount} serial number(s), but received ${actualCount}.`);
        this.name = 'SerialCountMismatchError';
    }
}
exports.SerialCountMismatchError = SerialCountMismatchError;
class DuplicateSerialNumberError extends Error {
    constructor(serialNumber, context) {
        super(`Duplicate serial number '${serialNumber}'${context ? ` (${context})` : ''}.`);
        this.name = 'DuplicateSerialNumberError';
    }
}
exports.DuplicateSerialNumberError = DuplicateSerialNumberError;
class DuplicateImeiError extends Error {
    constructor(imei) {
        super(`Duplicate IMEI '${imei}' is already registered.`);
        this.name = 'DuplicateImeiError';
    }
}
exports.DuplicateImeiError = DuplicateImeiError;
class SerialNotFoundError extends Error {
    constructor(identifier) {
        super(`Serial number '${identifier}' was not found in the system.`);
        this.name = 'SerialNotFoundError';
    }
}
exports.SerialNotFoundError = SerialNotFoundError;
class SerialNotAvailableError extends Error {
    constructor(serialNumber, currentStatus) {
        super(`Serial '${serialNumber}' is not available for sale. Current status: '${currentStatus}'.`);
        this.name = 'SerialNotAvailableError';
    }
}
exports.SerialNotAvailableError = SerialNotAvailableError;
class SerialAlreadySoldError extends Error {
    constructor(serialNumber) {
        super(`Serial '${serialNumber}' has already been sold or allocated by another counter.`);
        this.name = 'SerialAlreadySoldError';
    }
}
exports.SerialAlreadySoldError = SerialAlreadySoldError;
class SerialProductMismatchError extends Error {
    constructor(serialNumber, expectedProduct, actualProduct) {
        super(`Serial '${serialNumber}' belongs to product '${actualProduct}', not the expected product '${expectedProduct}'.`);
        this.name = 'SerialProductMismatchError';
    }
}
exports.SerialProductMismatchError = SerialProductMismatchError;
class SerialLocationMismatchError extends Error {
    constructor(serialNumber, expectedLocationId, actualLocationId) {
        super(`Serial '${serialNumber}' is physically located at location '${actualLocationId}', not location '${expectedLocationId}'.`);
        this.name = 'SerialLocationMismatchError';
    }
}
exports.SerialLocationMismatchError = SerialLocationMismatchError;
class InvalidSerialStatusTransitionError extends Error {
    constructor(serialNumber, fromStatus, toStatus) {
        super(`Invalid status transition for serial '${serialNumber}' from '${fromStatus}' to '${toStatus}'.`);
        this.name = 'InvalidSerialStatusTransitionError';
    }
}
exports.InvalidSerialStatusTransitionError = InvalidSerialStatusTransitionError;
class ManualSerialEntryNotAllowedError extends Error {
    constructor(productName) {
        super(`Manual serial entry is disabled for product '${productName}'. Serial numbers must be captured via barcode scanner.`);
        this.name = 'ManualSerialEntryNotAllowedError';
    }
}
exports.ManualSerialEntryNotAllowedError = ManualSerialEntryNotAllowedError;
class WarrantyExpiredError extends Error {
    constructor(serialNumber, endDate) {
        super(`Warranty for serial '${serialNumber}' expired on ${endDate}.`);
        this.name = 'WarrantyExpiredError';
    }
}
exports.WarrantyExpiredError = WarrantyExpiredError;
class UnauthorizedReturnError extends Error {
    constructor(serialNumber) {
        super(`Return of serial '${serialNumber}' without original receipt requires manager authorization.`);
        this.name = 'UnauthorizedReturnError';
    }
}
exports.UnauthorizedReturnError = UnauthorizedReturnError;
class SerialRules {
    /**
     * Validates purchase receiving of serial-tracked items
     */
    static validateReceiving(productName, quantityScaled, serials, settings, hasManagerOverride = false) {
        const expectedCount = Math.round(quantityScaled / 1000);
        if (serials.length !== expectedCount) {
            throw new SerialCountMismatchError(productName, expectedCount, serials.length);
        }
        // Check for internal duplicates within the receiving payload
        const serialSet = new Set();
        const imeiSet = new Set();
        for (const item of serials) {
            const cleanSerial = item.serialNumber?.trim();
            if (!cleanSerial) {
                throw new Error('Serial number cannot be blank in receipt payload.');
            }
            if (serialSet.has(cleanSerial.toUpperCase())) {
                throw new DuplicateSerialNumberError(cleanSerial, 'within receipt payload');
            }
            serialSet.add(cleanSerial.toUpperCase());
            // Validate format
            if (settings?.serialFormatRule) {
                const formatRes = (0, serial_math_1.validateSerialFormat)(cleanSerial, settings.serialFormatRule);
                if (!formatRes.isValid) {
                    throw new Error(`Serial '${cleanSerial}' validation failed: ${formatRes.error}`);
                }
            }
            // Validate manual entry permissions
            if (settings && !settings.allowManualSerialEntry && item.isManualEntry && !hasManagerOverride) {
                throw new ManualSerialEntryNotAllowedError(productName);
            }
            // Validate IMEI 1
            if (item.imei1) {
                const cleanImei = item.imei1.trim();
                const imeiVal = (0, serial_math_1.validateImei)(cleanImei);
                if (!imeiVal.isValid) {
                    throw new Error(`IMEI 1 '${cleanImei}' is invalid: ${imeiVal.error}`);
                }
                if (imeiSet.has(cleanImei)) {
                    throw new DuplicateImeiError(cleanImei);
                }
                imeiSet.add(cleanImei);
            }
            // Validate IMEI 2
            if (item.imei2) {
                const cleanImei2 = item.imei2.trim();
                const imeiVal2 = (0, serial_math_1.validateImei)(cleanImei2);
                if (!imeiVal2.isValid) {
                    throw new Error(`IMEI 2 '${cleanImei2}' is invalid: ${imeiVal2.error}`);
                }
                if (imeiSet.has(cleanImei2)) {
                    throw new DuplicateImeiError(cleanImei2);
                }
                imeiSet.add(cleanImei2);
            }
        }
    }
    /**
     * Validates sale eligibility for a specific serial record
     */
    static validateSaleSerialEligibility(serial, expectedProductId, expectedLocationId) {
        if (String(serial.productId) !== String(expectedProductId)) {
            throw new SerialProductMismatchError(serial.serialNumber, expectedProductId, String(serial.productId));
        }
        if (serial.status === 'sold') {
            throw new SerialAlreadySoldError(serial.serialNumber);
        }
        if (serial.status !== 'in_stock') {
            throw new SerialNotAvailableError(serial.serialNumber, serial.status);
        }
        if (serial.currentLocationId && String(serial.currentLocationId) !== String(expectedLocationId)) {
            throw new SerialLocationMismatchError(serial.serialNumber, expectedLocationId, serial.currentLocationId);
        }
    }
    /**
     * Validates status transition rules
     */
    static validateStatusTransition(serialNumber, currentStatus, targetStatus) {
        const validTransitions = {
            in_stock: ['reserved', 'sold', 'quarantined', 'under_repair', 'written_off'],
            reserved: ['in_stock', 'sold', 'quarantined'],
            sold: ['returned', 'under_repair'],
            returned: ['in_stock', 'quarantined', 'under_repair', 'written_off'],
            under_repair: ['in_stock', 'quarantined', 'written_off', 'sold'],
            quarantined: ['in_stock', 'under_repair', 'written_off'],
            written_off: [] // Terminal state
        };
        const allowed = validTransitions[currentStatus] || [];
        if (!allowed.includes(targetStatus)) {
            throw new InvalidSerialStatusTransitionError(serialNumber, currentStatus, targetStatus);
        }
    }
    /**
     * Validates customer return authorization and condition
     */
    static validateCustomerReturn(serial, condition, hasOriginalReceipt, managerApproved) {
        if (serial.status !== 'sold') {
            throw new Error(`Serial '${serial.serialNumber}' cannot be returned because its status is '${serial.status}' (expected 'sold').`);
        }
        if (!hasOriginalReceipt && !managerApproved) {
            throw new UnauthorizedReturnError(serial.serialNumber);
        }
        // Determine target status according to return condition
        switch (condition) {
            case 'working':
                // Policy: Returned working product can return to in_stock
                return 'in_stock';
            case 'damaged':
                return 'under_repair';
            case 'inspection':
            default:
                return 'quarantined';
        }
    }
}
exports.SerialRules = SerialRules;
