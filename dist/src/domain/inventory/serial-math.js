"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateImei = validateImei;
exports.validateSerialFormat = validateSerialFormat;
exports.parseDateUtc = parseDateUtc;
exports.formatDateUtc = formatDateUtc;
exports.calculateWarrantyEndDate = calculateWarrantyEndDate;
exports.isWarrantyActive = isWarrantyActive;
exports.calculateWarrantyDaysRemaining = calculateWarrantyDaysRemaining;
/**
 * Validates an International Mobile Equipment Identity (IMEI) using the Luhn Algorithm (Mod 10).
 * Standard IMEI is 15 decimal digits.
 */
function validateImei(imei) {
    if (!imei) {
        return { isValid: false, error: 'IMEI cannot be empty' };
    }
    const clean = imei.trim();
    if (!/^\d+$/.test(clean)) {
        return { isValid: false, error: 'IMEI must contain only numeric digits' };
    }
    if (clean.length !== 15) {
        return { isValid: false, error: `IMEI must be exactly 15 digits (got ${clean.length})` };
    }
    // Calculate Luhn checksum for the first 14 digits
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        let digit = parseInt(clean.charAt(i), 10);
        // Double every second digit from the left for IMEI (positions 1, 3, 5, 7, 9, 11, 13)
        if (i % 2 !== 0) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
    }
    const expectedCheckDigit = (10 - (sum % 10)) % 10;
    const actualCheckDigit = parseInt(clean.charAt(14), 10);
    if (expectedCheckDigit !== actualCheckDigit) {
        return {
            isValid: false,
            error: `Invalid IMEI Luhn check digit: expected ${expectedCheckDigit}, got ${actualCheckDigit}`
        };
    }
    return { isValid: true };
}
/**
 * Validates a serial number string against an optional format rule.
 */
function validateSerialFormat(serial, rule) {
    if (!serial || serial.trim().length === 0) {
        return { isValid: false, error: 'Serial number cannot be empty' };
    }
    const trimmed = serial.trim();
    if (!rule) {
        return { isValid: true };
    }
    if (rule.minLength && trimmed.length < rule.minLength) {
        return {
            isValid: false,
            error: `Serial number length ${trimmed.length} is less than minimum ${rule.minLength}`
        };
    }
    if (rule.maxLength && trimmed.length > rule.maxLength) {
        return {
            isValid: false,
            error: `Serial number length ${trimmed.length} exceeds maximum ${rule.maxLength}`
        };
    }
    if (rule.prefix && !trimmed.startsWith(rule.prefix)) {
        return {
            isValid: false,
            error: `Serial number must start with prefix '${rule.prefix}'`
        };
    }
    if (rule.pattern) {
        try {
            const regex = new RegExp(rule.pattern);
            if (!regex.test(trimmed)) {
                return {
                    isValid: false,
                    error: `Serial number does not match required pattern '${rule.pattern}'`
                };
            }
        }
        catch {
            // Invalid regex pattern configuration
        }
    }
    if (rule.validateImeiLuhn) {
        // Only validate serial as IMEI if it is formatted as an IMEI (15 digits or numeric)
        if (/^\d+$/.test(trimmed) || trimmed.length === 15) {
            const imeiRes = validateImei(trimmed);
            if (!imeiRes.isValid) {
                return imeiRes;
            }
        }
    }
    return { isValid: true };
}
/**
 * Parses YYYY-MM-DD as UTC midnight date
 */
function parseDateUtc(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    }
    return new Date(dateStr);
}
/**
 * Formats a Date object as YYYY-MM-DD
 */
function formatDateUtc(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/**
 * Computes warranty end date given start date and duration in months.
 * Clamps days to end of month when necessary (e.g., 2024-01-31 + 1 month -> 2024-02-29).
 */
function calculateWarrantyEndDate(startDateStr, months) {
    const date = parseDateUtc(startDateStr);
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() + months;
    const originalDay = date.getUTCDate();
    // Create date with 1st of target month
    const targetDate = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0));
    // Find max days in target month
    const lastDayOfMonth = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, 0, 0, 0, 0, 0)).getUTCDate();
    const finalDay = Math.min(originalDay, lastDayOfMonth);
    targetDate.setUTCDate(finalDay);
    return formatDateUtc(targetDate);
}
/**
 * Checks whether warranty is active at reference date (defaults to today).
 */
function isWarrantyActive(startDateStr, endDateStr, referenceDateStr) {
    const refDate = referenceDateStr ? parseDateUtc(referenceDateStr) : new Date();
    const start = parseDateUtc(startDateStr);
    if (refDate.getTime() < start.getTime()) {
        return false;
    }
    if (!endDateStr) {
        return true; // Lifetime warranty
    }
    const end = parseDateUtc(endDateStr);
    // Active up to end of the expiration day (23:59:59 UTC)
    return refDate.getTime() <= end.getTime() + 86400000 - 1;
}
/**
 * Calculates remaining days in warranty period.
 * Negative indicates expired.
 */
function calculateWarrantyDaysRemaining(endDateStr, referenceDateStr) {
    if (!endDateStr)
        return 999999; // Lifetime
    const refDate = referenceDateStr ? parseDateUtc(referenceDateStr) : new Date();
    const refUtc = Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate());
    const end = parseDateUtc(endDateStr);
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const msDiff = endUtc - refUtc;
    return Math.floor(msDiff / 86400000);
}
