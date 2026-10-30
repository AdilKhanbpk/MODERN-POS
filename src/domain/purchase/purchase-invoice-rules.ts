import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchaseInvoiceSettings,
  ThreeWayMatchReport
} from '../../shared/types/purchase-invoice';

export class DuplicateSupplierInvoiceError extends Error {
  constructor(supplierInvoiceNumber: string, supplierName: string) {
    super(`Supplier invoice number '${supplierInvoiceNumber}' has already been registered for supplier '${supplierName}'.`);
    this.name = 'DuplicateSupplierInvoiceError';
  }
}

export class OverInvoicingError extends Error {
  constructor(productName: string, invoicedUnits: number, acceptedUnits: number) {
    super(`Cannot invoice ${invoicedUnits} units of '${productName}' because only ${acceptedUnits} units have been accepted on the Goods Receiving Note.`);
    this.name = 'OverInvoicingError';
  }
}

export class PriceVarianceExceededError extends Error {
  constructor(invoiceNumber: string, varianceMinor: number, limitMinor: number) {
    super(`Invoice #${invoiceNumber} has a total price variance of ${varianceMinor} minor units exceeding the authorized threshold of ${limitMinor} minor units. Manager approval is required.`);
    this.name = 'PriceVarianceExceededError';
  }
}

export class ClosedAccountingPeriodError extends Error {
  constructor(invoiceDate: string, closedPeriodName?: string) {
    super(`Cannot post or record purchase invoice on date '${invoiceDate}' because it falls within a closed accounting period${closedPeriodName ? ` (${closedPeriodName})` : ''}.`);
    this.name = 'ClosedAccountingPeriodError';
  }
}

export class InactiveSupplierError extends Error {
  constructor(supplierName: string) {
    super(`Cannot process purchase invoice for deactivated supplier '${supplierName}'.`);
    this.name = 'InactiveSupplierError';
  }
}

export class CannotVoidPaidInvoiceError extends Error {
  constructor(invoiceNumber: string, paidMinor: number) {
    super(`Cannot void purchase invoice #${invoiceNumber} because ${paidMinor} minor currency units have already been paid against it.`);
    this.name = 'CannotVoidPaidInvoiceError';
  }
}

export class InvoiceAlreadyPostedError extends Error {
  constructor(invoiceNumber: string) {
    super(`Purchase invoice #${invoiceNumber} is already posted.`);
    this.name = 'InvoiceAlreadyPostedError';
  }
}

export class InvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Purchase invoice '${id}' was not found.`);
    this.name = 'InvoiceNotFoundError';
  }
}

export class InvoiceBeforeGRNNotAllowedError extends Error {
  constructor() {
    super(`Invoicing before goods receipt is disabled by company policy. An approved Goods Receiving Note is required.`);
    this.name = 'InvoiceBeforeGRNNotAllowedError';
  }
}

export class InvalidInvoiceStatusTransitionError extends Error {
  constructor(from: PurchaseInvoiceStatus, to: PurchaseInvoiceStatus) {
    super(`Cannot transition purchase invoice from '${from}' to '${to}'.`);
    this.name = 'InvalidInvoiceStatusTransitionError';
  }
}

export class PurchaseInvoiceRules {
  public static validateStatusTransition(
    currentStatus: PurchaseInvoiceStatus,
    targetStatus: PurchaseInvoiceStatus
  ): void {
    const validTransitions: Record<PurchaseInvoiceStatus, PurchaseInvoiceStatus[]> = {
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

  public static validatePosting(
    invoice: PurchaseInvoice,
    matchReport: ThreeWayMatchReport | null,
    settings: PurchaseInvoiceSettings | null,
    actor: { role?: string; isManager?: boolean; userId?: string | number } = {},
    managerApproved: boolean = false
  ): void {
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
        throw new PriceVarianceExceededError(
          invoice.invoiceNumber,
          matchReport.totalPriceVarianceMinor,
          settings?.priceVarianceThresholdMinor || 1000
        );
      }
    }
  }

  public static validateVoid(invoice: PurchaseInvoice): void {
    if (invoice.paidMinor > 0) {
      throw new CannotVoidPaidInvoiceError(invoice.invoiceNumber, invoice.paidMinor);
    }
    if (invoice.status === 'voided') {
      throw new Error(`Invoice #${invoice.invoiceNumber} is already voided.`);
    }
  }
}

