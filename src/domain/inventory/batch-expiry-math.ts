import {
  DaysUntilExpiryResult,
  BatchAllocation
} from '../../shared/types/batch-expiry';

export interface FefoCandidateBatch {
  id: string;
  batchNumber: string;
  expiryDate?: string | null;
  createdAt: string;
  onHandScaled: number;
  reservedScaled: number;
  availableScaled: number;
  costMinor?: number;
}

export interface FefoAllocationResult {
  allocations: BatchAllocation[];
  allocatedQuantityScaled: number;
  shortfallScaled: number;
  isFullyAllocated: boolean;
}

export class BatchExpiryMath {
  /**
   * Determines if a year is a leap year according to the Gregorian calendar.
   */
  public static isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  /**
   * Formats a date into ISO calendar format YYYY-MM-DD.
   */
  public static formatCalendarDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Parses YYYY-MM-DD into a UTC midnight Date object to prevent timezone shifts.
   */
  public static parseDateUtc(dateStr: string): Date {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD.`);
    }
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    // Validate day of month (including leap year Feb 29)
    const daysInMonth = [
      31,
      this.isLeapYear(year) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31
    ];

    if (month < 0 || month > 11 || day < 1 || day > daysInMonth[month]) {
      throw new Error(`Invalid calendar date: "${dateStr}". Day ${day} is invalid for month ${month + 1} in year ${year}.`);
    }

    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  }

  /**
   * Calculates days remaining until batch expiry using exact calendar day boundaries.
   * Day boundary policy:
   * - DaysRemaining = (ExpiryDateMidnight - TodayMidnight) in 24-hour increments.
   * - DaysRemaining < 0: Already expired (e.g. -1 means expired yesterday).
   * - DaysRemaining === 0: Expiring today.
   * - DaysRemaining <= warningDays: Expiring soon.
   * - DaysRemaining > warningDays: Good standing.
   */
  public static calculateDaysUntilExpiry(
    expiryDateStr: string | null | undefined,
    warningDays: number = 30,
    referenceDateStr?: string
  ): DaysUntilExpiryResult {
    if (!expiryDateStr || !expiryDateStr.trim()) {
      return {
        daysRemaining: 999999,
        isExpired: false,
        isExpiringToday: false,
        isExpiringSoon: false,
        status: 'NO_EXPIRY',
        formattedExpiryDate: 'N/A'
      };
    }

    const expiryUtc = this.parseDateUtc(expiryDateStr.slice(0, 10));

    let refUtc: Date;
    if (referenceDateStr) {
      refUtc = this.parseDateUtc(referenceDateStr.slice(0, 10));
    } else {
      const now = new Date();
      refUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    }

    const diffMs = expiryUtc.getTime() - refUtc.getTime();
    const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const isExpired = daysRemaining < 0;
    const isExpiringToday = daysRemaining === 0;
    const isExpiringSoon = daysRemaining > 0 && daysRemaining <= warningDays;

    let status: 'EXPIRED' | 'EXPIRING_TODAY' | 'EXPIRING_SOON' | 'GOOD' | 'NO_EXPIRY' = 'GOOD';
    if (isExpired) status = 'EXPIRED';
    else if (isExpiringToday) status = 'EXPIRING_TODAY';
    else if (isExpiringSoon) status = 'EXPIRING_SOON';

    return {
      daysRemaining,
      isExpired,
      isExpiringToday,
      isExpiringSoon,
      status,
      formattedExpiryDate: expiryDateStr.slice(0, 10)
    };
  }

  /**
   * Executes FEFO (First Expired, First Out) batch selection and allocation.
   * Deterministic ordering:
   * 1. Earliest expiry date first (ASC). Null expiry dates sorted last.
   * 2. For identical expiry dates: deterministic secondary ordering by receipt date (createdAt ASC).
   * 3. Batch ID as tie-breaker (ASC).
   */
  public static allocateFefoBatches(
    candidateBatches: FefoCandidateBatch[],
    requestedQuantityScaled: number
  ): FefoAllocationResult {
    if (requestedQuantityScaled <= 0) {
      return {
        allocations: [],
        allocatedQuantityScaled: 0,
        shortfallScaled: 0,
        isFullyAllocated: true
      };
    }

    // Sort batches strictly by FEFO:
    // 1. Expiry date ASC (nulls last)
    // 2. CreatedAt ASC
    // 3. Batch ID ASC
    const sorted = [...candidateBatches].sort((a, b) => {
      // Handle null expiry dates
      if (!a.expiryDate && b.expiryDate) return 1;
      if (a.expiryDate && !b.expiryDate) return -1;
      if (a.expiryDate && b.expiryDate) {
        const cmp = a.expiryDate.localeCompare(b.expiryDate);
        if (cmp !== 0) return cmp;
      }

      // Tie breaker 1: createdAt
      const createdCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (createdCmp !== 0) return createdCmp;

      // Tie breaker 2: id
      return String(a.id).localeCompare(String(b.id));
    });

    const allocations: BatchAllocation[] = [];
    let remainingNeededScaled = requestedQuantityScaled;

    for (const batch of sorted) {
      if (remainingNeededScaled <= 0) break;

      const availableScaled = Math.max(0, batch.availableScaled);
      if (availableScaled <= 0) continue;

      const toAllocateScaled = Math.min(remainingNeededScaled, availableScaled);

      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate || null,
        quantityScaled: toAllocateScaled,
        unitCostMinor: batch.costMinor || 0
      });

      remainingNeededScaled -= toAllocateScaled;
    }

    const totalAllocatedScaled = requestedQuantityScaled - remainingNeededScaled;

    return {
      allocations,
      allocatedQuantityScaled: totalAllocatedScaled,
      shortfallScaled: remainingNeededScaled,
      isFullyAllocated: remainingNeededScaled === 0
    };
  }
}

