/**
 * Domain: Customer Account Statement
 * Formulates the authoritative running balance and financial history for customer ledgers.
 *
 * Rules:
 *   1. Opening Balance establishes the starting debt (+ receivable, - advance credit).
 *   2. Credit Sales increase debt (Debit).
 *   3. Fully paid cash sales do NOT alter the customer's debt (Debit = 0, Credit = 0).
 *   4. Partially paid sales only record the net unpaid balance as a Debit (Debit = Total - Paid, Credit = 0).
 *   5. Payments Received / Receipts reduce customer debt (Credit).
 *   6. Sales Returns / Credit Notes reduce customer debt (Credit).
 *   7. Running Balance is deterministically computed chronologically:
 *      Running Balance = Previous Balance + Debit - Credit.
 *   8. Each transaction entry provides a direct action link to Open Bill or Open Transaction.
 */

import { formatCurrency } from '../money/money';

export type StatementEventType =
  | 'OPENING_BALANCE'
  | 'CREDIT_SALE'
  | 'CASH_SALE_PAID'
  | 'PARTIAL_PAYMENT_SALE'
  | 'PAYMENT_RECEIVED'
  | 'SALE_RETURN'
  | 'ADJUSTMENT';

export interface RawLedgerTransactionInput {
  date: string;
  sourceType: 'SALE' | 'PAYMENT' | 'SALE_RETURN' | 'OPENING_BALANCE' | 'ADJUSTMENT';
  sourceId?: number;
  referenceNumber?: string;
  saleTotalMinor?: number;
  amountPaidMinor?: number;
  creditOrRefundMinor?: number;
  manualDebitMinor?: number;
  manualCreditMinor?: number;
  notes?: string;
}

export interface StatementEntry {
  id: number;
  date: string;
  eventType: StatementEventType;
  description: string;
  referenceType: string;
  referenceId?: number;
  referenceNumber?: string;
  debitMinor: number;
  creditMinor: number;
  runningBalanceMinor: number;
  openAction?: {
    actionName: 'OPEN_BILL' | 'OPEN_TRANSACTION';
    targetId: number;
    documentType: string;
  };
}

export interface CustomerStatementResult {
  customerId: number;
  customerName: string;
  openingBalanceMinor: number;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  closingBalanceMinor: number;
  entries: StatementEntry[];
}

export class CustomerStatementCalculator {
  /**
   * Generates a fully audited customer statement with running balances and Open Bill actions.
   */
  public static generateStatement(params: {
    customerId: number;
    customerName: string;
    openingBalanceMinor?: number;
    transactions: RawLedgerTransactionInput[];
  }): CustomerStatementResult {
    let currentBalance = Math.round(params.openingBalanceMinor || 0);
    const openingBalance = currentBalance;
    let totalDebits = 0;
    let totalCredits = 0;

    const entries: StatementEntry[] = [];
    let entryId = 1;

    // Add explicit opening balance entry if non-zero
    if (openingBalance !== 0) {
      entries.push({
        id: entryId++,
        date: params.transactions[0]?.date || new Date().toISOString().split('T')[0],
        eventType: 'OPENING_BALANCE',
        description: 'Opening Balance Forward',
        referenceType: 'OPENING_BALANCE',
        debitMinor: openingBalance > 0 ? openingBalance : 0,
        creditMinor: openingBalance < 0 ? Math.abs(openingBalance) : 0,
        runningBalanceMinor: currentBalance
      });
      if (openingBalance > 0) totalDebits += openingBalance;
      else totalCredits += Math.abs(openingBalance);
    }

    for (const tx of params.transactions) {
      let debit = 0;
      let credit = 0;
      let eventType: StatementEventType = 'ADJUSTMENT';
      let description = tx.notes || '';
      let openAction: StatementEntry['openAction'] = undefined;

      switch (tx.sourceType) {
        case 'SALE': {
          const total = Math.round(tx.saleTotalMinor || 0);
          const paid = Math.round(tx.amountPaidMinor || 0);

          if (paid >= total) {
            // Case 1: Fully paid cash sale -> does NOT change customer outstanding balance!
            eventType = 'CASH_SALE_PAID';
            description = `Cash sale #${tx.referenceNumber || tx.sourceId} (Total ${formatCurrency(total)}), fully paid`;
            debit = 0;
            credit = 0;
          } else if (paid === 0) {
            // Case 2: Full credit sale
            eventType = 'CREDIT_SALE';
            description = `Credit sale #${tx.referenceNumber || tx.sourceId} (${formatCurrency(total)})`;
            debit = total;
            credit = 0;
          } else {
            // Case 3: Partial payment credit sale
            const unpaid = total - paid;
            eventType = 'PARTIAL_PAYMENT_SALE';
            description = `Sale #${tx.referenceNumber || tx.sourceId} (${formatCurrency(total)}), ${formatCurrency(paid)} paid upfront, ${formatCurrency(unpaid)} on credit`;
            debit = unpaid;
            credit = 0;
          }

          if (tx.sourceId) {
            openAction = {
              actionName: 'OPEN_BILL',
              targetId: tx.sourceId,
              documentType: 'SALE'
            };
          }
          break;
        }

        case 'PAYMENT': {
          eventType = 'PAYMENT_RECEIVED';
          const amt = Math.round(tx.amountPaidMinor || tx.manualCreditMinor || 0);
          credit = amt;
          debit = 0;
          description = `Payment received #${tx.referenceNumber || tx.sourceId || ''} (${formatCurrency(amt)})`;
          if (tx.sourceId) {
            openAction = {
              actionName: 'OPEN_TRANSACTION',
              targetId: tx.sourceId,
              documentType: 'PAYMENT'
            };
          }
          break;
        }

        case 'SALE_RETURN': {
          eventType = 'SALE_RETURN';
          const refund = Math.round(tx.creditOrRefundMinor || 0);
          credit = refund;
          debit = 0;
          description = `Credit note / Sale return #${tx.referenceNumber || tx.sourceId || ''} (${formatCurrency(refund)})`;
          if (tx.sourceId) {
            openAction = {
              actionName: 'OPEN_TRANSACTION',
              targetId: tx.sourceId,
              documentType: 'SALE_RETURN'
            };
          }
          break;
        }

        case 'ADJUSTMENT':
        default: {
          debit = Math.round(tx.manualDebitMinor || 0);
          credit = Math.round(tx.manualCreditMinor || 0);
          eventType = 'ADJUSTMENT';
          description = tx.notes || 'Balance adjustment';
          break;
        }
      }

      currentBalance = currentBalance + debit - credit;
      totalDebits += debit;
      totalCredits += credit;

      entries.push({
        id: entryId++,
        date: tx.date,
        eventType,
        description,
        referenceType: tx.sourceType,
        referenceId: tx.sourceId,
        referenceNumber: tx.referenceNumber,
        debitMinor: debit,
        creditMinor: credit,
        runningBalanceMinor: currentBalance,
        openAction
      });
    }

    return {
      customerId: params.customerId,
      customerName: params.customerName,
      openingBalanceMinor: openingBalance,
      totalDebitsMinor: totalDebits,
      totalCreditsMinor: totalCredits,
      closingBalanceMinor: currentBalance,
      entries
    };
  }
}

