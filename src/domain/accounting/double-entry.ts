import { AccountType, StandardAccountCode } from '../../shared/constants/accounts';
import { JournalEntryLine } from '../../shared/types';

export class DoubleEntryLedger {
  /**
   * Asserts that debit total equals credit total.
   */
  public static validateBalance(lines: JournalEntryLine[]): { isBalanced: boolean; discrepancy: number } {
    const totalDebits = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredits = lines.reduce((sum, line) => sum + line.credit, 0);

    const discrepancy = totalDebits - totalCredits;
    return {
      isBalanced: discrepancy === 0,
      discrepancy
    };
  }

  /**
   * Computes the new running balance for an account when applying debits and credits.
   */
  public static computeAccountBalance(
    currentBalance: number,
    accountType: AccountType,
    debit: number,
    credit: number
  ): number {
    switch (accountType) {
      case AccountType.ASSET:
      case AccountType.EXPENSE:
        // Normal Debit balance: Debit increases, Credit decreases
        return currentBalance + debit - credit;

      case AccountType.LIABILITY:
      case AccountType.EQUITY:
      case AccountType.REVENUE:
        // Normal Credit balance: Credit increases, Debit decreases
        return currentBalance + credit - debit;

      default:
        throw new Error(`Invalid account type: ${accountType}`);
    }
  }

  /**
   * Helper to create balanced journal entry lines for a completed POS Sale.
   */
  public static createSaleJournalLines(params: {
    cashAccountId: number;
    receivableAccountId: number;
    salesRevenueAccountId: number;
    taxPayableAccountId: number;
    cogsAccountId: number;
    inventoryAccountId: number;
    cashReceived: number;
    creditAmount: number;
    grossSales: number;
    salesTax: number;
    costOfGoodsSold: number;
  }): JournalEntryLine[] {
    const lines: JournalEntryLine[] = [];

    // 1. Debit Cash / Bank for cash received
    if (params.cashReceived > 0) {
      lines.push({
        accountId: params.cashAccountId,
        debit: params.cashReceived,
        credit: 0,
        memo: 'Cash received from sale'
      });
    }

    // 2. Debit Accounts Receivable for credit portion
    if (params.creditAmount > 0) {
      lines.push({
        accountId: params.receivableAccountId,
        debit: params.creditAmount,
        credit: 0,
        memo: 'Customer credit receivable'
      });
    }

    // 3. Credit Sales Revenue
    const netRevenue = (params.cashReceived + params.creditAmount) - params.salesTax;
    lines.push({
      accountId: params.salesRevenueAccountId,
      debit: 0,
      credit: netRevenue,
      memo: 'Sales revenue earned'
    });

    // 4. Credit Sales Tax Payable
    if (params.salesTax > 0) {
      lines.push({
        accountId: params.taxPayableAccountId,
        debit: 0,
        credit: params.salesTax,
        memo: 'Sales tax collected'
      });
    }

    // 5. Inventory and COGS entry: Debit COGS, Credit Inventory Asset
    if (params.costOfGoodsSold > 0) {
      lines.push({
        accountId: params.cogsAccountId,
        debit: params.costOfGoodsSold,
        credit: 0,
        memo: 'Cost of goods sold'
      });

      lines.push({
        accountId: params.inventoryAccountId,
        debit: 0,
        credit: params.costOfGoodsSold,
        memo: 'Inventory reduction from sale'
      });
    }

    return lines;
  }
}

