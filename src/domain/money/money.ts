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

export const DEFAULT_CURRENCY_CODE = 'PKR';
export const DEFAULT_CURRENCY_PRECISION = 2;
export const DEFAULT_MINOR_UNIT_MULTIPLIER = 100; // 10^2

export class MoneyPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyPrecisionError';
  }
}

/**
 * Converts decimal currency amount (e.g. Rupees 25.50) into authoritative integer minor units (paisa).
 */
export function toMinorUnits(decimalAmount: number, precision = DEFAULT_CURRENCY_PRECISION): number {
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
      throw new MoneyPrecisionError(
        `Amount ${decimalAmount} exceeds currency precision of ${precision} decimal places. Quiet rounding is prohibited.`
      );
    }
  }
  return rounded;
}

/**
 * Converts authoritative integer minor units (paisa) into a decimal major currency amount.
 */
export function fromMinorUnits(minorUnits: number, precision = DEFAULT_CURRENCY_PRECISION): number {
  if (!Number.isInteger(minorUnits)) {
    throw new MoneyPrecisionError(`Authoritative money minor units ${minorUnits} must be an integer.`);
  }
  const divisor = Math.pow(10, precision);
  return minorUnits / divisor;
}

/**
 * Formats minor units (paisa) into standard PKR currency string (e.g. "Rs 25.50").
 */
export function formatCurrency(
  minorUnits: number,
  currencyCode = 'PKR',
  currencySymbol = 'Rs.',
  precision = DEFAULT_CURRENCY_PRECISION
): string {
  const decimal = fromMinorUnits(minorUnits, precision);
  const formatted = decimal.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
  const sym = currencySymbol.trimEnd();
  return `${sym} ${formatted}`;
}

export class Money {
  private readonly _minorUnits: number;
  private readonly _precision: number;

  constructor(minorUnits: number, precision = DEFAULT_CURRENCY_PRECISION) {
    if (!Number.isFinite(minorUnits)) {
      throw new MoneyPrecisionError(`Invalid money amount: ${minorUnits}`);
    }
    this._minorUnits = Math.round(minorUnits);
    this._precision = precision;
  }

  public static fromMinorUnits(minorUnits: number, precision = DEFAULT_CURRENCY_PRECISION): Money {
    return new Money(minorUnits, precision);
  }

  public static fromCents(cents: number): Money {
    return new Money(cents, 2);
  }

  public static fromPaisa(paisa: number): Money {
    return new Money(paisa, 2);
  }

  public static fromDecimal(amount: number, precision = DEFAULT_CURRENCY_PRECISION): Money {
    return new Money(toMinorUnits(amount, precision), precision);
  }

  public static zero(precision = DEFAULT_CURRENCY_PRECISION): Money {
    return new Money(0, precision);
  }

  public get minorUnits(): number {
    return this._minorUnits;
  }

  public get cents(): number {
    return this._minorUnits;
  }

  public get paisa(): number {
    return this._minorUnits;
  }

  public get precision(): number {
    return this._precision;
  }

  public get decimal(): number {
    return fromMinorUnits(this._minorUnits, this._precision);
  }

  public add(other: Money): Money {
    if (this._precision !== other._precision) {
      throw new MoneyPrecisionError('Cannot add money values with differing precision scales.');
    }
    return new Money(this._minorUnits + other.minorUnits, this._precision);
  }

  public subtract(other: Money): Money {
    if (this._precision !== other._precision) {
      throw new MoneyPrecisionError('Cannot subtract money values with differing precision scales.');
    }
    return new Money(this._minorUnits - other.minorUnits, this._precision);
  }

  public multiply(factor: number): Money {
    return new Money(Math.round(this._minorUnits * factor), this._precision);
  }

  public divide(divisor: number): Money {
    if (divisor === 0) {
      throw new MoneyPrecisionError('Cannot divide money by zero');
    }
    return new Money(Math.round(this._minorUnits / divisor), this._precision);
  }

  public percentage(percent: number): Money {
    if (percent < 0) {
      throw new MoneyPrecisionError('Percentage cannot be negative');
    }
    return new Money(Math.round((this._minorUnits * percent) / 100), this._precision);
  }

  public isPositive(): boolean {
    return this._minorUnits > 0;
  }

  public isNegative(): boolean {
    return this._minorUnits < 0;
  }

  public isZero(): boolean {
    return this._minorUnits === 0;
  }

  public equals(other: Money): boolean {
    return this._minorUnits === other.minorUnits && this._precision === other.precision;
  }

  public format(currencySymbol = 'Rs'): string {
    return formatCurrency(this._minorUnits, 'PKR', currencySymbol, this._precision);
  }
}
