"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseInvoiceRules = exports.InvalidInvoiceStatusTransitionError = exports.InvoiceBeforeGRNNotAllowedError = exports.InvoiceNotFoundError = exports.InvoiceAlreadyPostedError = exports.CannotVoidPaidInvoiceError = exports.InactiveSupplierError = exports.ClosedAccountingPeriodError = exports.PriceVarianceExceededError = exports.OverInvoicingError = exports.DuplicateSupplierInvoiceError = void 0;
class DuplicateSupplierInvoiceError extends Error {
    constructor(supplierInvoiceNumber, supplierName) {
        super(`Supplier invoice number '${supplierInvoiceNumber}' has already been registered for supplier '${supplierName}'.`);
        this.name = 'DuplicateSupplierInvoiceError';
    }
}
exports.DuplicateSupplierInvoiceError = DuplicateSupplierInvoiceError;
class OverInvoicingError extends Error {
    constructor(productName, invoicedUnits, acceptedUnits) {
        super(`Cannot invoice ${invoicedUnits} units of '${productName}' because only ${acceptedUnits} units have been accepted on the Goods Receiving Note.`);
        this.name = 'OverInvoicingError';
    }
}
exports.OverInvoicingError = OverInvoicingError;
class PriceVarianceExceededError extends Error {
    constructor(invoiceNumber, varianceMinor, limitMinor) {
        super(`Invoice #${invoiceNumber} has a total price variance of ${varianceMinor} minor units exceeding the authorized threshold of ${limitMinor} minor units. Manager approval is required.`);
        this.name = 'PriceVarianceExceededError';
    }
}
exports.PriceVarianceExceededError = PriceVarianceExceededError;
class ClosedAccountingPeriodError extends Error {
    constructor(invoiceDate, closedPeriodName) {
        super(`Cannot post or record purchase invoice on date '${invoiceDate}' because it falls within a closed accounting period${closedPeriodName ? ` (${closedPeriodName})` : ''}.`);
        this.name = 'ClosedAccountingPeriodError';
    }
}
exports.ClosedAccountingPeriodError = ClosedAccountingPeriodError;
class InactiveSupplierError extends Error {
    constructor(supplierName) {
        super(`Cannot process purchase invoice for deactivated supplier '${supplierName}'.`);
        this.name = 'InactiveSupplierError';
    }
}
exports.InactiveSupplierError = InactiveSupplierError;
class CannotVoidPaidInvoiceError extends Error {
    constructor(invoiceNumber, paidMinor) {
        super(`Cannot void purchase invoice #${invoiceNumber} because ${paidMinor} minor currency units have already been paid against it.`);
        this.name = 'CannotVoidPaidInvoiceError';
    }
}
exports.CannotVoidPaidInvoiceError = CannotVoidPaidInvoiceError;
class InvoiceAlreadyPostedError extends Error {
    constructor(invoiceNumber) {
        super(`Purchase invoice #${invoiceNumber} is already posted.`);
        this.name = 'InvoiceAlreadyPostedError';
    }
}
exports.InvoiceAlreadyPostedError = InvoiceAlreadyPostedError;
class InvoiceNotFoundError extends Error {
    constructor(id) {
        super(`Purchase invoice '${id}' was not found.`);
        this.name = 'InvoiceNotFoundError';
    }
}
exports.InvoiceNotFoundError = InvoiceNotFoundError;
class InvoiceBeforeGRNNotAllowedError extends Error {
    constructor() {
        super(`Invoicing before goods receipt is disabled by company policy. An approved Goods Receiving Note is required.`);
        this.name = 'InvoiceBeforeGRNNotAllowedError';
    }
}
exports.InvoiceBeforeGRNNotAllowedError = InvoiceBeforeGRNNotAllowedError;
class InvalidInvoiceStatusTransitionError extends Error {
    constructor(from, to) {
        super(`Cannot transition purchase invoice from '${from}' to '${to}'.`);
        this.name = 'InvalidInvoiceStatusTransitionError';
    }
}
exports.InvalidInvoiceStatusTransitionError = InvalidInvoiceStatusTransitionError;
class PurchaseInvoiceRules {
    static validateStatusTransition(currentStatus, targetStatus) {
        const validTransitions = {
            draft: ['pending_approval', 'posted', 'voided'],
            pending_approval: ['draft', 'posted', 'voided'],
            posted: ['partially_paid', 'paid', 'voided'],
            partially_paid: ['paid'],
            paid: [],
            voided: []
        };
        const allowed = validTransitions[currentStatus] || [];
        if (!allowed.includes(targetStatus)) {
            throw new InvalidInvoiceStatusTransitionError(currentStatus, targetStatus);
        }
    }
    static validatePosting(invoice, matchReport, settings, actor = {}, managerApproved = false) {
        if (invoice.status === 'posted') {
            throw new InvoiceAlreadyPostedError(invoice.invoiceNumber);
        }
        if (invoice.status === 'voided') {
            throw new Error(`Cannot post voided purchase invoice #${invoice.invoiceNumber}.`);
        }
        // Check manager authorization if price variance exceeded
        if (matchReport?.requiresManagerApproval && !managerApproved) {
            const isManager = actor.isManager || ['manager', 'admin', 'owner'].includes((actor.role || '').toLowerCase());
            if (!isManager) {
                throw new PriceVarianceExceededError(invoice.invoiceNumber, matchReport.totalPriceVarianceMinor, settings?.priceVarianceThresholdMinor || 1000);
            }
        }
    }
    static validateVoid(invoice) {
        if (invoice.paidMinor > 0) {
            throw new CannotVoidPaidInvoiceError(invoice.invoiceNumber, invoice.paidMinor);
        }
        if (invoice.status === 'voided') {
            throw new Error(`Invoice #${invoice.invoiceNumber} is already voided.`);
        }
    }
}
exports.PurchaseInvoiceRules = PurchaseInvoiceRules;
