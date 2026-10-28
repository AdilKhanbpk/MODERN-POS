import { Sale, SaleItem, SaleLine, SaleReturn } from '../../types';

export interface ISaleRepository {
  getNextInvoiceNumber(): string;
  create(sale: {
    invoiceNumber: string;
    customerId?: number;
    cashierId: number;
    locationId?: number;
    registerId?: number;
    subtotal: number;
    totalDiscount: number;
    totalTax: number;
    grandTotal: number;
    totalCost: number;
    profit: number;
    paymentMethod: string;
    amountPaid: number;
    changeGiven: number;
    customerBalanceChange: number;
    notes?: string;
  }): number;
  createItem(item: {
    saleId: number;
    productId: number;
    variantId?: number;
    productName: string;
    productSku?: string;
    productBarcode: string;
    unitId?: number;
    unitName: string;
    quantity: number;
    quantityScaled?: number;
    conversionFactor: number;
    conversionNumerator?: number;
    conversionDenominator?: number;
    unitPrice: number;
    costPrice: number;
    lineDiscount: number;
    allocatedBillDiscountMinor?: number;
    taxRate?: number;
    isTaxInclusive?: boolean;
    lineTax: number;
    lineTotal: number;
    lineProfit: number;
  }): void;
  findById(id: number): Sale | null;
  list(limit?: number): Sale[];
  voidSale(id: number): void;
  createSaleReturn(ret: {
    returnNumber: string;
    originalSaleId: number;
    customerId?: number;
    locationId: number;
    reason: string;
    refundMinor: number;
    createdBy: number;
    lines: Array<{
      productId: number;
      variantId?: number;
      quantityScaled: number;
      disposition: 'RETURN_TO_STOCK' | 'DAMAGED_WRITE_OFF' | 'WARRANTY_REPAIR';
      refundMinor: number;
    }>;
  }): number;
}

