"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoubleEntryLedger = void 0;
const accounts_1 = require("../../shared/constants/accounts");
class DoubleEntryLedger {
    /**
     * Asserts that debit total equals credit total.
     */
    static validateBalance(lines) {
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
    static computeAccountBalance(currentBalance, accountType, debit, credit) {
        switch (accountType) {
            case accounts_1.AccountType.ASSET:
            case accounts_1.AccountType.EXPENSE:
                // Normal Debit balance: Debit increases, Credit decreases
                return currentBalance + debit - credit;
            case accounts_1.AccountType.LIABILITY:
            case accounts_1.AccountType.EQUITY:
            case accounts_1.AccountType.REVENUE:
                // Normal Credit balance: Credit increases, Debit decreases
                return currentBalance + credit - debit;
            default:
                throw new Error(`Invalid account type: ${accountType}`);
        }
    }
    /**
     * Helper to create balanced journal entry lines for a completed POS Sale.
     */
    static createSaleJournalLines(params) {
        const lines = [];
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
exports.DoubleEntryLedger = DoubleEntryLedger;
