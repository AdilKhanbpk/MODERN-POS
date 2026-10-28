import { Account, JournalEntry, JournalEntryLine } from '../../types';

export interface IAccountRepository {
  list(): Account[];
  findById(id: number): Account | null;
  findByCode(code: string): Account | null;
  updateBalance(accountId: number, newBalance: number): void;
  createJournalEntry(entry: {
    entryNumber: string;
    referenceType: string;
    referenceId?: number;
    description: string;
    totalAmount: number;
    lines: JournalEntryLine[];
  }): number;
  listJournalEntries(limit?: number): JournalEntry[];
  getTrialBalance(): Array<{
    code: string;
    name: string;
    type: string;
    debit: number;
    credit: number;
  }>;
}

