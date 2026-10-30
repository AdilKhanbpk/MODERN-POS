import {
  ProductSerialSettings,
  ProductSerialNumber,
  SerialItemInput,
  SerialStatus
} from '../../shared/types/serial-tracking';
import { validateSerialFormat, validateImei, isWarrantyActive } from './serial-math';

export class SerialRequiredError extends Error {
  constructor(productName: string) {
    super(`Product '${productName}' requires serial number tracking. Serial number must be specified.`);
    this.name = 'SerialRequiredError';
  }
}

export class SerialCountMismatchError extends Error {
  constructor(productName: string, expectedCount: number, actualCount: number) {
    super(
      `Serial count mismatch for '${productName}': expected ${expectedCount} serial number(s), but received ${actualCount}.`
    );
    this.name = 'SerialCountMismatchError';
  }
}

export class DuplicateSerialNumberError extends Error {
  constructor(serialNumber: string, context?: string) {
    super(`Duplicate serial number '${serialNumber}'${context ? ` (${context})` : ''}.`);
    this.name = 'DuplicateSerialNumberError';
  }
}

export class DuplicateImeiError extends Error {
  constructor(imei: string) {
    super(`Duplicate IMEI '${imei}' is already registered.`);
    this.name = 'DuplicateImeiError';
  }
}

export class SerialNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Serial number '${identifier}' was not found in the system.`);
    this.name = 'SerialNotFoundError';
  }
}

export class SerialNotAvailableError extends Error {
  constructor(serialNumber: string, currentStatus: string) {
    super(`Serial '${serialNumber}' is not available for sale. Current status: '${currentStatus}'.`);
    this.name = 'SerialNotAvailableError';
  }
}

export class SerialAlreadySoldError extends Error {
  constructor(serialNumber: string) {
    super(`Serial '${serialNumber}' has already been sold or allocated by another counter.`);
    this.name = 'SerialAlreadySoldError';
  }
}

export class SerialProductMismatchError extends Error {
  constructor(serialNumber: string, expectedProduct: string, actualProduct: string) {
    super(
      `Serial '${serialNumber}' belongs to product '${actualProduct}', not the expected product '${expectedProduct}'.`
    );
    this.name = 'SerialProductMismatchError';
  }
}

export class SerialLocationMismatchError extends Error {
  constructor(serialNumber: string, expectedLocationId: string, actualLocationId: string) {
    super(
      `Serial '${serialNumber}' is physically located at location '${actualLocationId}', not location '${expectedLocationId}'.`
    );
    this.name = 'SerialLocationMismatchError';
  }
}

export class InvalidSerialStatusTransitionError extends Error {
  constructor(serialNumber: string, fromStatus: string, toStatus: string) {
    super(`Invalid status transition for serial '${serialNumber}' from '${fromStatus}' to '${toStatus}'.`);
    this.name = 'InvalidSerialStatusTransitionError';
  }
}

export class ManualSerialEntryNotAllowedError extends Error {
  constructor(productName: string) {
    super(
      `Manual serial entry is disabled for product '${productName}'. Serial numbers must be captured via barcode scanner.`
    );
    this.name = 'ManualSerialEntryNotAllowedError';
  }
}

export class WarrantyExpiredError extends Error {
  constructor(serialNumber: string, endDate: string) {
    super(`Warranty for serial '${serialNumber}' expired on ${endDate}.`);
    this.name = 'WarrantyExpiredError';
  }
}

export class UnauthorizedReturnError extends Error {
  constructor(serialNumber: string) {
    super(`Return of serial '${serialNumber}' without original receipt requires manager authorization.`);
    this.name = 'UnauthorizedReturnError';
  }
}

export class SerialRules {
  /**
   * Validates purchase receiving of serial-tracked items
   */
  public static validateReceiving(
    productName: string,
    quantityScaled: number,
    serials: SerialItemInput[],
    settings?: ProductSerialSettings | null,
    hasManagerOverride = false
  ): void {
    const expectedCount = Math.round(quantityScaled / 1000);
    if (serials.length !== expectedCount) {
      throw new SerialCountMismatchError(productName, expectedCount, serials.length);
    }

    // Check for internal duplicates within the receiving payload
    const serialSet = new Set<string>();
    const imeiSet = new Set<string>();

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
        const formatRes = validateSerialFormat(cleanSerial, settings.serialFormatRule);
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
        const imeiVal = validateImei(cleanImei);
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
        const imeiVal2 = validateImei(cleanImei2);
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
  public static validateSaleSerialEligibility(
    serial: ProductSerialNumber,
    expectedProductId: string,
    expectedLocationId: string
  ): void {
    if (String(serial.productId) !== String(expectedProductId)) {
      throw new SerialProductMismatchError(
        serial.serialNumber,
        expectedProductId,
        String(serial.productId)
      );
    }

    if (serial.status === 'sold') {
      throw new SerialAlreadySoldError(serial.serialNumber);
    }

    if (serial.status !== 'in_stock') {
      throw new SerialNotAvailableError(serial.serialNumber, serial.status);
    }

    if (serial.currentLocationId && String(serial.currentLocationId) !== String(expectedLocationId)) {
      throw new SerialLocationMismatchError(
        serial.serialNumber,
        expectedLocationId,
        serial.currentLocationId
      );
    }
  }

  /**
   * Validates status transition rules
   */
  public static validateStatusTransition(
    serialNumber: string,
    currentStatus: SerialStatus,
    targetStatus: SerialStatus
  ): void {
    const validTransitions: Record<SerialStatus, SerialStatus[]> = {
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
  public static validateCustomerReturn(
    serial: ProductSerialNumber,
    condition: 'working' | 'damaged' | 'inspection',
    hasOriginalReceipt: boolean,
    managerApproved: boolean
  ): SerialStatus {
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
