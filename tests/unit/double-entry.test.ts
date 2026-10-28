import { describe, it, expect } from 'vitest';
import { DoubleEntryLedger } from '../../src/domain/accounting/double-entry';
import { AccountType } from '../../src/shared/constants/accounts';

describe('Domain: DoubleEntryLedger', () => {
  it('validates that debits must equal credits', () => {
    const balancedLines = [
      { accountId: 1, debit: 1000, credit: 0 },
      { accountId: 2, debit: 0, credit: 1000 }
    ];
    expect(DoubleEntryLedger.validateBalance(balancedLines).isBalanced).toBe(true);

    const unbalancedLines = [
      { accountId: 1, debit: 1000, credit: 0 },
      { accountId: 2, debit: 0, credit: 800 }
    ];
    const check = DoubleEntryLedger.validateBalance(unbalancedLines);
    expect(check.isBalanced).toBe(false);
    expect(check.discrepancy).toBe(200);
  });

  it('updates normal account balances appropriately by account classification', () => {
    // Asset: Debit increases (+100), Credit decreases (-50)
    expect(DoubleEntryLedger.computeAccountBalance(1000, AccountType.ASSET, 100, 50)).toBe(1050);

    // Liability: Credit increases (+200), Debit decreases (-100)
    expect(DoubleEntryLedger.computeAccountBalance(500, AccountType.LIABILITY, 100, 200)).toBe(600);
  });
});

