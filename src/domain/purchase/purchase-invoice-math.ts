import {
  ThreeWayMatchLineComparison,
  ThreeWayMatchReport,
  ThreeWayMatchStatus
} from '../../shared/types/purchase-invoice';

export class PurchaseInvoiceMath {
  /**
   * Calculates the line total in minor units:
   * LineTotal = (QuantityScaled * UnitPriceMinor / 1000) - DiscountMinor + TaxMinor
   */
  public static calculateLineTotal(input: {
    quantityScaled: number;
    unitPriceMinor: number;
    discountMinor?: number;
    taxMinor?: number;
    isTaxInclusive?: boolean;
    taxRatePercent?: number;
  }): {
    grossMinor: number;
    discountMinor: number;
    taxableMinor: number;
    taxMinor: number;
    lineTotalMinor: number;
  } {
    const qty = Math.max(0, Math.round(input.quantityScaled));
    const unitPrice = Math.max(0, Math.round(input.unitPriceMinor));
    const discount = Math.max(0, Math.round(input.discountMinor || 0));

    // Base value before discount
    const grossMinor = Math.round((qty / 1000) * unitPrice);
    const afterDiscountMinor = Math.max(0, grossMinor - discount);

    let taxMinor = Math.max(0, Math.round(input.taxMinor || 0));

    // Calculate tax from percent if rate given and taxMinor not explicitly specified
    if (input.taxRatePercent !== undefined && input.taxRatePercent > 0 && input.taxMinor === undefined) {
      if (input.isTaxInclusive) {
        // Tax included in gross: Tax = afterDiscount * rate / (100 + rate)
        taxMinor = Math.round((afterDiscountMinor * input.taxRatePercent) / (100 + input.taxRatePercent));
      } else {
        // Tax charged separately: Tax = afterDiscount * rate / 100
        taxMinor = Math.round((afterDiscountMinor * input.taxRatePercent) / 100);
      }
    }

    const taxableMinor = input.isTaxInclusive
      ? Math.max(0, afterDiscountMinor - taxMinor)
      : afterDiscountMinor;

    const lineTotalMinor = input.isTaxInclusive
      ? afterDiscountMinor
      : afterDiscountMinor + taxMinor;

    return {
      grossMinor,
      discountMinor: discount,
      taxableMinor,
      taxMinor,
      lineTotalMinor
    };
  }

  /**
   * Calculates total header financial values:
   * Total = Subtotal - Discount + Tax + Shipping + OtherCharges
   * Outstanding = Total - Paid
   */
  public static calculateInvoiceTotals(input: {
    lines: Array<{ lineTotalMinor: number; discountMinor?: number; taxMinor?: number }>;
    headerDiscountMinor?: number;
    shippingMinor?: number;
    otherChargesMinor?: number;
    paidMinor?: number;
  }): {
    subtotalMinor: number;
    totalDiscountMinor: number;
    totalTaxMinor: number;
    shippingMinor: number;
    otherChargesMinor: number;
    totalMinor: number;
    paidMinor: number;
    outstandingMinor: number;
  } {
    const subtotalMinor = input.lines.reduce((sum, l) => sum + (l.lineTotalMinor || 0), 0);
    const lineDiscountMinor = input.lines.reduce((sum, l) => sum + (l.discountMinor || 0), 0);
    const headerDiscountMinor = Math.max(0, Math.round(input.headerDiscountMinor || 0));
    const totalDiscountMinor = lineDiscountMinor + headerDiscountMinor;

    const totalTaxMinor = input.lines.reduce((sum, l) => sum + (l.taxMinor || 0), 0);
    const shippingMinor = Math.max(0, Math.round(input.shippingMinor || 0));
    const otherChargesMinor = Math.max(0, Math.round(input.otherChargesMinor || 0));

    const totalMinor = Math.max(0, subtotalMinor + shippingMinor + otherChargesMinor);
    const paidMinor = Math.max(0, Math.round(input.paidMinor || 0));
    const outstandingMinor = Math.max(0, totalMinor - paidMinor);

    return {
      subtotalMinor,
      totalDiscountMinor,
      totalTaxMinor,
      shippingMinor,
      otherChargesMinor,
      totalMinor,
      paidMinor,
      outstandingMinor
    };
  }

  /**
   * Exact integer currency exchange rate conversion:
   * BaseMinor = round(ForeignMinor * Numerator / Denominator)
   */
  public static convertCurrency(
    amountMinor: number,
    numerator: number = 1,
    denominator: number = 1
  ): number {
    if (numerator <= 0 || denominator <= 0) {
      throw new Error(`Invalid exchange rate fraction ${numerator}/${denominator}`);
    }
    return Math.round((amountMinor * numerator) / denominator);
  }

  /**
   * Computes a 3-way match line comparison:
   * - Invoiced vs Ordered (from PO)
   * - Invoiced vs Accepted (from GRN)
   */
  public static evaluateThreeWayMatchLine(input: {
    lineId: string;
    productId: string;
    productName: string;
    unitId: string;
    unitName: string;
    invoicedQuantityScaled: number;
    invoicedUnitPriceMinor: number;
    purchaseOrderLineId?: string | null;
    orderedQuantityScaled?: number | null;
    poUnitPriceMinor?: number | null;
    goodsReceiptLineId?: string | null;
    acceptedQuantityScaled?: number | null;
    grnUnitCostMinor?: number | null;
    priceThresholdMinor: number;
    priceThresholdPercent: number;
  }): ThreeWayMatchLineComparison {
    const invQty = Math.round(input.invoicedQuantityScaled);
    const invPrice = Math.round(input.invoicedUnitPriceMinor);
    const accQty = input.acceptedQuantityScaled != null ? Math.round(input.acceptedQuantityScaled) : null;
    const ordQty = input.orderedQuantityScaled != null ? Math.round(input.orderedQuantityScaled) : null;

    // Benchmark unit price: prioritize PO unit price, then GRN provisional unit cost, then invPrice
    const benchmarkUnitPrice = input.poUnitPriceMinor ?? input.grnUnitCostMinor ?? invPrice;

    // Quantity variance: Invoiced - Accepted (if GRN exists)
    const quantityVarianceScaled = accQty != null ? invQty - accQty : 0;

    // Price variance per unit: InvoicedPrice - BenchmarkPrice
    const unitPriceVarianceMinor = invPrice - benchmarkUnitPrice;

    // Line financial variance: (InvoicedQty / 1000) * UnitPriceVariance
    const totalFinancialVarianceMinor = Math.round((invQty / 1000) * unitPriceVarianceMinor);

    // Price variance percent: |UnitPriceVariance / BenchmarkPrice| * 100
    const priceVariancePercent = benchmarkUnitPrice > 0
      ? Math.abs(Number(((unitPriceVarianceMinor / benchmarkUnitPrice) * 100).toFixed(2)))
      : 0;

    // Determine Status
    let status: ThreeWayMatchStatus = 'exact_match';
    let notes: string | undefined = undefined;

    if (!input.purchaseOrderLineId && !input.goodsReceiptLineId) {
      status = 'no_po_reference';
      notes = 'Direct invoice without PO or GRN reference';
    } else if (accQty != null && invQty > accQty) {
      status = 'quantity_mismatch';
      notes = `Over-invoiced by ${(invQty - accQty) / 1000} units`;
    } else if (Math.abs(totalFinancialVarianceMinor) > input.priceThresholdMinor || priceVariancePercent > input.priceThresholdPercent) {
      status = 'variance_exceeded';
      notes = `Price variance of ${unitPriceVarianceMinor > 0 ? '+' : ''}${unitPriceVarianceMinor} (${priceVariancePercent}%) exceeds threshold`;
    } else if (unitPriceVarianceMinor !== 0) {
      status = 'acceptable_variance';
      notes = `Price variance of ${unitPriceVarianceMinor > 0 ? '+' : ''}${unitPriceVarianceMinor} within tolerance`;
    }

    return {
      purchaseInvoiceLineId: input.lineId,
      productId: input.productId,
      productName: input.productName,
      unitId: input.unitId,
      unitName: input.unitName,
      purchaseOrderLineId: input.purchaseOrderLineId || null,
      orderedQuantityScaled: ordQty,
      poUnitPriceMinor: input.poUnitPriceMinor || null,
      goodsReceiptLineId: input.goodsReceiptLineId || null,
      acceptedQuantityScaled: accQty,
      grnUnitCostMinor: input.grnUnitCostMinor || null,
      invoicedQuantityScaled: invQty,
      invoicedUnitPriceMinor: invPrice,
      quantityVarianceScaled,
      unitPriceVarianceMinor,
      priceVariancePercent,
      totalFinancialVarianceMinor,
      status,
      notes
    };
  }
}

