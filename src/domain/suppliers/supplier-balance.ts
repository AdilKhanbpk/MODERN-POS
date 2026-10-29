/**
 * Domain: Supplier Accounts Payable Ledger & Allocation Engine
 *
 * Enforces authoritative Accounts Payable (liability) rules:
 * - Purchase on credit: increases payable -> CREDIT
 * - Opening balance (payable): increases payable -> CREDIT
 * - Supplier payment: decreases payable -> DEBIT
 * - Supplier return: decreases payable -> DEBIT
 * - Supplier credit note / debit adjustment: decreases payable -> DEBIT
 * - Reversal of a payment: restores payable -> CREDIT
 * - Reversal of a purchase: cancels payable -> DEBIT
 *
 * Balance Formula:
 * Payable Balance = Total Credits - Total Debits
 * (A positive balance indicates the business owes money to the supplier)
 */

export class SupplierBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierBalanceError';
  }
}

export class InactiveSupplierError extends SupplierBalanceError {
  constructor(supplierName: string) {
    super(`Cannot post transaction: Supplier '${supplierName}' is inactive or archived.`);
    this.name = 'InactiveSupplierError';
  }
}

export class OverAllocationError extends SupplierBalanceError {
  constructor(allocated: number, available: number, target: string) {
    super(
      `Allocation violation: Allocated amount (${allocated}) exceeds available ${target} (${available}).`
    );
    this.name = 'OverAllocationError';
  }
}

export class PaymentReversalError extends SupplierBalanceError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentReversalError';
  }
}

export interface LedgerDelta {
  debitMinor: number;
  creditMinor: number;
  entryType: string;
  description: string;
}

export class SupplierBalanceCalculator {
  /**
   * Authoritative calculation of Accounts Payable from ledger entries:
   * Balance = Sum(Credit) - Sum(Debit)
   */
  public static calculateBalance(entries: Array<{ debitMinor?: number; creditMinor?: number }>): number {
    let balance = 0;
    for (const entry of entries) {
      const credit = Number(entry.creditMinor || 0);
      const debit = Number(entry.debitMinor || 0);
      balance += (credit - debit);
    }
    return balance;
  }

  /**
   * Computes running balance for a chronologically sorted list of entries
   */
  public static computeRunningBalances<T extends { debitMinor?: number; creditMinor?: number }>(
    entries: T[],
    initialBalance: number = 0
  ): Array<T & { runningBalanceMinor: number }> {
    let running = initialBalance;
    return entries.map(entry => {
      const credit = Number(entry.creditMinor || 0);
      const debit = Number(entry.debitMinor || 0);
      running += (credit - debit);
      return {
        ...entry,
        runningBalanceMinor: running
      };
    });
  }

  /**
   * Validates allocation requests against total payment amount and document remaining due
   */
  public static validateAllocations(
    paymentAmountMinor: number,
    allocations: Array<{
      purchaseDocumentId: string | number;
      allocatedMinor: number;
      remainingDueMinor: number;
    }>
  ): { totalAllocatedMinor: number; unallocatedAdvanceMinor: number } {
    if (paymentAmountMinor <= 0) {
      throw new SupplierBalanceError('Payment amount must be greater than zero');
    }

    let totalAllocated = 0;

    for (const alloc of allocations) {
      if (alloc.allocatedMinor <= 0) {
        throw new SupplierBalanceError(`Allocated amount must be greater than zero for document ${alloc.purchaseDocumentId}`);
      }

      if (alloc.allocatedMinor > alloc.remainingDueMinor) {
        throw new OverAllocationError(
          alloc.allocatedMinor,
          alloc.remainingDueMinor,
          `document ${alloc.purchaseDocumentId} remaining due`
        );
      }

      totalAllocated += alloc.allocatedMinor;
    }

    if (totalAllocated > paymentAmountMinor) {
      throw new OverAllocationError(
        totalAllocated,
        paymentAmountMinor,
        'total payment amount'
      );
    }

    const unallocatedAdvanceMinor = paymentAmountMinor - totalAllocated;
    return {
      totalAllocatedMinor: totalAllocated,
      unallocatedAdvanceMinor
    };
  }

  /**
   * Generates reversing ledger delta for an existing entry
   */
  public static createReversalDelta(originalEntry: {
    debitMinor: number;
    creditMinor: number;
    description?: string | null;
  }, reason: string): LedgerDelta {
    // If original was debit (e.g. payment), reversal is credit
    // If original was credit (e.g. purchase), reversal is debit
    return {
      debitMinor: originalEntry.creditMinor,
      creditMinor: originalEntry.debitMinor,
      entryType: originalEntry.debitMinor > 0 ? 'PAYMENT_REVERSAL' : 'BILL_REVERSAL',
      description: `REVERSAL: ${originalEntry.description || ''} (Reason: ${reason})`
    };
  }
}

