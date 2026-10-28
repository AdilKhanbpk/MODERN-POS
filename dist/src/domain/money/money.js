"use strict";
/**
 * Domain: Money
 * All monetary amounts are handled strictly as integer minor units (e.g. PKR Paisa / Cents)
 * to prevent IEEE 754 floating-point rounding errors.
 *
 * Examples (PKR):
 *   Rs 100.00 = 10,000 paisa
 *   Rs  25.50 =  2,550 paisa
 *   Rs   0.75 =     75 paisa
 *
 * Never use JavaScript floating-point arithmetic as the final authoritative source of truth.
 * Currency precision is defined in system settings (default: 2 decimals = 100 minor units per major unit).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Money = exports.MoneyPrecisionError = exports.DEFAULT_MINOR_UNIT_MULTIPLIER = exports.DEFAULT_CURRENCY_PRECISION = exports.DEFAULT_CURRENCY_CODE = void 0;
exports.toMinorUnits = toMinorUnits;
exports.fromMinorUnits = fromMinorUnits;
exports.formatCurrency = formatCurrency;
exports.DEFAULT_CURRENCY_CODE = 'PKR';
exports.DEFAULT_CURRENCY_PRECISION = 2;
exports.DEFAULT_MINOR_UNIT_MULTIPLIER = 100; // 10^2
class MoneyPrecisionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MoneyPrecisionError';
    }
}
exports.MoneyPrecisionError = MoneyPrecisionError;
/**
 * Converts decimal currency amount (e.g. Rupees 25.50) into authoritative integer minor units (paisa).
 */
function toMinorUnits(decimalAmount, precision = exports.DEFAULT_CURRENCY_PRECISION) {
    if (!Number.isFinite(decimalAmount)) {
        throw new MoneyPrecisionError(`Invalid currency amount: ${decimalAmount}`);
    }
    const multiplier = Math.pow(10, precision);
    const raw = decimalAmount * multiplier;
    const rounded = Math.round(raw);
    // Guard against float precision leaks (e.g. 10.0000000001)
    if (Math.abs(raw - rounded) > 0.001) {
        // If the input has more decimal places than currency precision allowed:
        const str = decimalAmount.toString();
        const parts = str.split('.');
        if (parts[1] && parts[1].length > precision) {
            throw new MoneyPrecisionError(`Amount ${decimalAmount} exceeds currency precision of ${precision} decimal places. Quiet rounding is prohibited.`);
        }
    }
    return rounded;
}
/**
 * Converts authoritative integer minor units (paisa) into a decimal major currency amount.
 */
function fromMinorUnits(minorUnits, precision = exports.DEFAULT_CURRENCY_PRECISION) {
    if (!Number.isInteger(minorUnits)) {
        throw new MoneyPrecisionError(`Authoritative money minor units ${minorUnits} must be an integer.`);
    }
    const divisor = Math.pow(10, precision);
    return minorUnits / divisor;
}
/**
 * Formats minor units (paisa) into standard PKR currency string (e.g. "Rs 25.50").
 */
function formatCurrency(minorUnits, currencyCode = 'PKR', currencySymbol = 'Rs.', precision = exports.DEFAULT_CURRENCY_PRECISION) {
    const decimal = fromMinorUnits(minorUnits, precision);
    const formatted = decimal.toLocaleString('en-US', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
    });
    const sym = currencySymbol.trimEnd();
    return `${sym} ${formatted}`;
}
class Money {
    _minorUnits;
    _precision;
    constructor(minorUnits, precision = exports.DEFAULT_CURRENCY_PRECISION) {
        if (!Number.isFinite(minorUnits)) {
            throw new MoneyPrecisionError(`Invalid money amount: ${minorUnits}`);
        }
        this._minorUnits = Math.round(minorUnits);
        this._precision = precision;
    }
    static fromMinorUnits(minorUnits, precision = exports.DEFAULT_CURRENCY_PRECISION) {
        return new Money(minorUnits, precision);
    }
    static fromCents(cents) {
        return new Money(cents, 2);
    }
    static fromPaisa(paisa) {
        return new Money(paisa, 2);
    }
    static fromDecimal(amount, precision = exports.DEFAULT_CURRENCY_PRECISION) {
        return new Money(toMinorUnits(amount, precision), precision);
    }
    static zero(precision = exports.DEFAULT_CURRENCY_PRECISION) {
        return new Money(0, precision);
    }
    get minorUnits() {
        return this._minorUnits;
    }
    get cents() {
        return this._minorUnits;
    }
    get paisa() {
        return this._minorUnits;
    }
    get precision() {
        return this._precision;
    }
    get decimal() {
        return fromMinorUnits(this._minorUnits, this._precision);
    }
    add(other) {
        if (this._precision !== other._precision) {
            throw new MoneyPrecisionError('Cannot add money values with differing precision scales.');
        }
        return new Money(this._minorUnits + other.minorUnits, this._precision);
    }
    subtract(other) {
        if (this._precision !== other._precision) {
            throw new MoneyPrecisionError('Cannot subtract money values with differing precision scales.');
        }
        return new Money(this._minorUnits - other.minorUnits, this._precision);
    }
    multiply(factor) {
        return new Money(Math.round(this._minorUnits * factor), this._precision);
    }
    divide(divisor) {
        if (divisor === 0) {
            throw new MoneyPrecisionError('Cannot divide money by zero');
        }
        return new Money(Math.round(this._minorUnits / divisor), this._precision);
    }
    percentage(percent) {
        if (percent < 0) {
            throw new MoneyPrecisionError('Percentage cannot be negative');
        }
        return new Money(Math.round((this._minorUnits * percent) / 100), this._precision);
    }
    isPositive() {
        return this._minorUnits > 0;
    }
    isNegative() {
        return this._minorUnits < 0;
    }
    isZero() {
        return this._minorUnits === 0;
    }
    equals(other) {
        return this._minorUnits === other.minorUnits && this._precision === other.precision;
    }
    format(currencySymbol = 'Rs') {
        return formatCurrency(this._minorUnits, 'PKR', currencySymbol, this._precision);
    }
}
exports.Money = Money;
