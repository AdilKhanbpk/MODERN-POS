"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierBalanceCalculator = exports.PaymentReversalError = exports.OverAllocationError = exports.InactiveSupplierError = exports.SupplierBalanceError = void 0;
class SupplierBalanceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SupplierBalanceError';
    }
}
exports.SupplierBalanceError = SupplierBalanceError;
class InactiveSupplierError extends SupplierBalanceError {
    constructor(supplierName) {
        super(`Cannot post transaction: Supplier '${supplierName}' is inactive or archived.`);
        this.name = 'InactiveSupplierError';
    }
}
exports.InactiveSupplierError = InactiveSupplierError;
class OverAllocationError extends SupplierBalanceError {
    constructor(allocated, available, target) {
        super(`Allocation violation: Allocated amount (${allocated}) exceeds available ${target} (${available}).`);
        this.name = 'OverAllocationError';
    }
}
exports.OverAllocationError = OverAllocationError;
class PaymentReversalError extends SupplierBalanceError {
    constructor(message) {
        super(message);
        this.name = 'PaymentReversalError';
    }
}
exports.PaymentReversalError = PaymentReversalError;
class SupplierBalanceCalculator {
    /**
     * Authoritative calculation of Accounts Payable from ledger entries:
     * Balance = Sum(Credit) - Sum(Debit)
     */
    static calculateBalance(entries) {
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
    static computeRunningBalances(entries, initialBalance = 0) {
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
    static validateAllocations(paymentAmountMinor, allocations) {
        if (paymentAmountMinor <= 0) {
            throw new SupplierBalanceError('Payment amount must be greater than zero');
        }
        let totalAllocated = 0;
        for (const alloc of allocations) {
            if (alloc.allocatedMinor <= 0) {
                throw new SupplierBalanceError(`Allocated amount must be greater than zero for document ${alloc.purchaseDocumentId}`);
            }
            if (alloc.allocatedMinor > alloc.remainingDueMinor) {
                throw new OverAllocationError(alloc.allocatedMinor, alloc.remainingDueMinor, `document ${alloc.purchaseDocumentId} remaining due`);
            }
            totalAllocated += alloc.allocatedMinor;
        }
        if (totalAllocated > paymentAmountMinor) {
            throw new OverAllocationError(totalAllocated, paymentAmountMinor, 'total payment amount');
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
    static createReversalDelta(originalEntry, reason) {
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
exports.SupplierBalanceCalculator = SupplierBalanceCalculator;
