"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScaleBarcodeError = void 0;
exports.calculateEan13CheckDigit = calculateEan13CheckDigit;
exports.parseScaleBarcode = parseScaleBarcode;
exports.testScaleBarcode = testScaleBarcode;
class ScaleBarcodeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScaleBarcodeError';
    }
}
exports.ScaleBarcodeError = ScaleBarcodeError;
/**
 * Calculates GS1 standard Modulo-10 check digit for EAN-13 barcode strings
 * (given at least 12 numeric characters).
 */
function calculateEan13CheckDigit(first12Digits) {
    if (first12Digits.length < 12 || !/^\d+$/.test(first12Digits)) {
        throw new ScaleBarcodeError(`Cannot calculate EAN-13 check digit: input must be at least 12 numeric digits, received "${first12Digits}".`);
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const digit = parseInt(first12Digits[i], 10);
        // Even indices (0, 2, 4...) have weight 1; odd indices (1, 3, 5...) have weight 3
        sum += i % 2 === 0 ? digit * 1 : digit * 3;
    }
    const remainder = sum % 10;
    return remainder === 0 ? 0 : 10 - remainder;
}
/**
 * Parses a scale barcode against a configured scale barcode profile.
 * Throws ScaleBarcodeError if invalid.
 */
function parseScaleBarcode(barcode, profile) {
    const cleaned = barcode.trim();
    // 1. Validate Prefix
    if (!cleaned.startsWith(profile.prefix)) {
        throw new ScaleBarcodeError(`Barcode "${cleaned}" does not match scale profile prefix "${profile.prefix}".`);
    }
    // 2. Validate Length
    if (cleaned.length !== profile.totalLength) {
        throw new ScaleBarcodeError(`Barcode length is ${cleaned.length}, but scale profile "${profile.name}" requires exactly ${profile.totalLength} characters.`);
    }
    // 3. Extract and validate Product Code
    const codeEnd = profile.productCodeStart + profile.productCodeLength;
    if (codeEnd > cleaned.length) {
        throw new ScaleBarcodeError(`Product code range [${profile.productCodeStart}..${codeEnd}] exceeds barcode length ${cleaned.length}.`);
    }
    const productCode = cleaned.substring(profile.productCodeStart, codeEnd);
    if (!productCode || !/^\d+$/.test(productCode)) {
        throw new ScaleBarcodeError(`Extracted product code segment "${productCode}" is not a valid numeric string.`);
    }
    // 4. Extract and validate Value Segment
    const valEnd = profile.valueStart + profile.valueLength;
    if (valEnd > cleaned.length) {
        throw new ScaleBarcodeError(`Value segment range [${profile.valueStart}..${valEnd}] exceeds barcode length ${cleaned.length}.`);
    }
    const valueStr = cleaned.substring(profile.valueStart, valEnd);
    if (!valueStr || !/^\d+$/.test(valueStr)) {
        throw new ScaleBarcodeError(`Extracted value segment "${valueStr}" is not a valid numeric string.`);
    }
    const rawValue = parseInt(valueStr, 10);
    const divisor = Math.pow(10, profile.decimalPlaces || 0);
    const parsedValue = Math.round((rawValue / divisor) * 10000) / 10000;
    // 5. Check Digit Validation (if configured)
    let checkDigit;
    let expectedCheckDigit;
    if (profile.checkDigitRule === 'EAN13_MOD10') {
        if (cleaned.length >= 13) {
            expectedCheckDigit = calculateEan13CheckDigit(cleaned.substring(0, 12));
            checkDigit = parseInt(cleaned[12], 10);
            if (checkDigit !== expectedCheckDigit) {
                throw new ScaleBarcodeError(`Invalid EAN-13 check digit: expected ${expectedCheckDigit}, received ${checkDigit}. Barcode checksum corrupted.`);
            }
        }
    }
    return {
        rawBarcode: cleaned,
        profileId: profile.id,
        profileName: profile.name,
        prefix: profile.prefix,
        productCode,
        valueType: profile.valueType,
        rawValue,
        parsedValue,
        isValid: true,
        checkDigit,
        expectedCheckDigit
    };
}
/**
 * Diagnostic tool for testing barcodes against a profile without throwing exceptions.
 * Returns breakdown of extracted segments.
 */
function testScaleBarcode(barcode, profile) {
    const cleaned = barcode.trim();
    const prefixSegment = cleaned.substring(0, profile.prefix.length);
    const codeEnd = profile.productCodeStart + profile.productCodeLength;
    const productCodeSegment = cleaned.substring(profile.productCodeStart, codeEnd);
    const valEnd = profile.valueStart + profile.valueLength;
    const valueSegment = cleaned.substring(profile.valueStart, valEnd);
    let checkDigitSegment;
    let expectedCheckDigit;
    if (profile.checkDigitRule === 'EAN13_MOD10' && cleaned.length >= 13) {
        checkDigitSegment = cleaned[12];
        try {
            expectedCheckDigit = calculateEan13CheckDigit(cleaned.substring(0, 12));
        }
        catch {
            // Ignored for diagnostic preview
        }
    }
    try {
        const parsed = parseScaleBarcode(cleaned, profile);
        return {
            isValid: true,
            rawBarcode: cleaned,
            profileName: profile.name,
            prefixSegment,
            productCodeSegment,
            valueSegment,
            valueType: profile.valueType,
            parsedValue: parsed.parsedValue,
            checkDigitSegment,
            expectedCheckDigit
        };
    }
    catch (err) {
        const rawVal = parseInt(valueSegment, 10) || 0;
        const div = Math.pow(10, profile.decimalPlaces || 0);
        return {
            isValid: false,
            rawBarcode: cleaned,
            profileName: profile.name,
            prefixSegment,
            productCodeSegment,
            valueSegment,
            valueType: profile.valueType,
            parsedValue: Math.round((rawVal / div) * 10000) / 10000,
            checkDigitSegment,
            expectedCheckDigit,
            error: err.message
        };
    }
}
