/**
 * Domain: Cash Drawer Reconciliation
 * Implements authoritative cash register closing formulas according to strict physical drawer rules.
 *
 * Formula:
 *   Expected Cash =
 *       Opening Cash
 *     + Cash Sales Received
 *     + Customer Payments Received in Cash
 *     + Other Authorized Cash-In
 *     - Cash Refunds
 *     - Cash Expenses
 *     - Cash Paid to Suppliers
 *     - Other Authorized Cash-Out
 *
 * Strict Non-Cash Exclusion Rule:
 *   Bank transfers, credit/debit cards, JazzCash, Easypaisa, and Raast do NOT enter
 *   the physical till drawer and MUST NOT be counted towards Expected Cash.
 */

import { formatCurrency } from '../money/money';

export type DrawerMovementType =
  | 'OPENING_FLOAT'
  | 'CASH_SALE'
  | 'CUSTOMER_PAYMENT'
  | 'CASH_IN'
  | 'CASH_SALE_REFUND'
  | 'EXPENSE_PAYOUT'
  | 'SUPPLIER_PAYMENT'
  | 'CASH_OUT';

export interface DrawerTransaction {
  id?: number;
  movementType: DrawerMovementType;
  paymentMethodType: 'CASH' | 'BANK' | 'CARD' | 'DIGITAL_WALLET' | 'OTHER';
  affectsCashDrawer: boolean;
  amountMinor: number;
  notes?: string;
  sourceId?: number;
  createdAt?: string;
}

export interface DrawerReconciliationInput {
  sessionId?: number;
  registerId?: number;
  cashierId?: number;
  openingCashMinor: number;
  transactions: DrawerTransaction[];
  countedCashMinor?: number;
}

export interface DrawerReconciliationResult {
  openingCashMinor: number;
  cashSalesMinor: number;
  customerReceiptsMinor: number;
  otherCashInMinor: number;
  totalCashInflowMinor: number;

  cashRefundsMinor: number;
  cashExpensesMinor: number;
  supplierPayoutsMinor: number;
  otherCashOutMinor: number;
  totalCashOutflowMinor: number;

  expectedCashMinor: number;
  countedCashMinor?: number;
  differenceMinor?: number;
  status: 'BALANCED' | 'SHORTAGE' | 'OVERAGE' | 'PENDING_COUNT';

  // Explicit non-cash tracking to audit separately
  nonCashAudits: {
    bankTransferMinor: number;
    cardPaymentMinor: number;
    digitalWalletMinor: number;
    otherNonCashMinor: number;
    totalNonCashMinor: number;
  };

  summaryText: string;
}

export class CashDrawerCalculator {
  /**
   * Authoritative calculation of expected drawer cash and audit reconciliation.
   */
  public static reconcile(input: DrawerReconciliationInput): DrawerReconciliationResult {
    const openingCash = Math.round(input.openingCashMinor || 0);

    let cashSales = 0;
    let customerReceipts = 0;
    let otherCashIn = 0;

    let cashRefunds = 0;
    let cashExpenses = 0;
    let supplierPayouts = 0;
    let otherCashOut = 0;

    let bankTransfer = 0;
    let cardPayment = 0;
    let digitalWallet = 0;
    let otherNonCash = 0;

    for (const tx of input.transactions) {
      const amount = Math.round(tx.amountMinor || 0);
      if (amount <= 0) continue;

      // Filter: If transaction method does NOT affect cash drawer, record in non-cash audits only
      if (!tx.affectsCashDrawer || tx.paymentMethodType !== 'CASH') {
        switch (tx.paymentMethodType) {
          case 'BANK':
            bankTransfer += amount;
            break;
          case 'CARD':
            cardPayment += amount;
            break;
          case 'DIGITAL_WALLET':
            digitalWallet += amount;
            break;
          default:
            otherNonCash += amount;
            break;
        }
        continue;
      }

      // Drawer movements
      switch (tx.movementType) {
        case 'CASH_SALE':
          cashSales += amount;
          break;
        case 'CUSTOMER_PAYMENT':
          customerReceipts += amount;
          break;
        case 'CASH_IN':
          otherCashIn += amount;
          break;
        case 'CASH_SALE_REFUND':
          cashRefunds += amount;
          break;
        case 'EXPENSE_PAYOUT':
          cashExpenses += amount;
          break;
        case 'SUPPLIER_PAYMENT':
          supplierPayouts += amount;
          break;
        case 'CASH_OUT':
          otherCashOut += amount;
          break;
        case 'OPENING_FLOAT':
          // opening float is handled separately via openingCash
          break;
      }
    }

    const totalCashInflow = cashSales + customerReceipts + otherCashIn;
    const totalCashOutflow = cashRefunds + cashExpenses + supplierPayouts + otherCashOut;

    // Formula: Opening + Inflows - Outflows
    const expectedCash = openingCash + totalCashInflow - totalCashOutflow;

    let differenceMinor: number | undefined = undefined;
    let status: DrawerReconciliationResult['status'] = 'PENDING_COUNT';

    if (input.countedCashMinor !== undefined) {
      const counted = Math.round(input.countedCashMinor);
      differenceMinor = counted - expectedCash;
      if (differenceMinor === 0) {
        status = 'BALANCED';
      } else if (differenceMinor < 0) {
        status = 'SHORTAGE';
      } else {
        status = 'OVERAGE';
      }
    }

    const totalNonCash = bankTransfer + cardPayment + digitalWallet + otherNonCash;

    const summaryText =
      `Expected Cash: ${formatCurrency(expectedCash)} ` +
      `(Opening: ${formatCurrency(openingCash)}, Inflows: ${formatCurrency(totalCashInflow)}, Outflows: ${formatCurrency(totalCashOutflow)}) | ` +
      (countedCashMinorDescription(input.countedCashMinor, differenceMinor, status)) +
      ` | Non-Cash Total: ${formatCurrency(totalNonCash)} (Bank: ${formatCurrency(bankTransfer)}, Card: ${formatCurrency(cardPayment)}, Wallet: ${formatCurrency(digitalWallet)})`;

    return {
      openingCashMinor: openingCash,
      cashSalesMinor: cashSales,
      customerReceiptsMinor: customerReceipts,
      otherCashInMinor: otherCashIn,
      totalCashInflowMinor: totalCashInflow,

      cashRefundsMinor: cashRefunds,
      cashExpensesMinor: cashExpenses,
      supplierPayoutsMinor: supplierPayouts,
      otherCashOutMinor: otherCashOut,
      totalCashOutflowMinor: totalCashOutflow,

      expectedCashMinor: expectedCash,
      countedCashMinor: input.countedCashMinor !== undefined ? Math.round(input.countedCashMinor) : undefined,
      differenceMinor,
      status,

      nonCashAudits: {
        bankTransferMinor: bankTransfer,
        cardPaymentMinor: cardPayment,
        digitalWalletMinor: digitalWallet,
        otherNonCashMinor: otherNonCash,
        totalNonCashMinor: totalNonCash
      },

      summaryText
    };
  }
}

function countedCashMinorDescription(
  counted: number | undefined,
  diff: number | undefined,
  status: DrawerReconciliationResult['status']
): string {
  if (counted === undefined || diff === undefined) {
    return 'Drawer not yet counted';
  }
  if (status === 'BALANCED') {
    return `Counted: ${formatCurrency(counted)} (Perfect balance)`;
  }
  if (status === 'SHORTAGE') {
    return `Counted: ${formatCurrency(counted)} (Deficit: ${formatCurrency(Math.abs(diff))})`;
  }
  return `Counted: ${formatCurrency(counted)} (Surplus: ${formatCurrency(diff)})`;
}

