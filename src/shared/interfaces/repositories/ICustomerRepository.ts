import { Customer, CustomerLedgerEntry } from '../../types';

export interface ICustomerRepository {
  list(): Customer[];
  findById(id: number): Customer | null;
  search(query: string): Customer[];
  create(customer: {
    customerCode?: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    creditLimitMinor?: number;
    creditLimit?: number;
    openingBalanceMinor?: number;
    isActive?: boolean;
  }): number;
  addLedgerEntry(entry: {
    customerId: number;
    entryType?: string;
    transactionType?: string;
    debitMinor?: number;
    debit?: number;
    creditMinor?: number;
    credit?: number;
    runningBalance?: number;
    sourceType?: string;
    sourceId?: number;
    referenceId?: number;
    notes?: string;
  }): number;
  calculateLedgerBalance(customerId: number): number;
  reconcileBalance(customerId: number): {
    isReconciled: boolean;
    cachedBalance: number;
    ledgerBalance: number;
    discrepancy: number;
  };
  updateBalance(customerId: number, newBalance: number): void;
  getLedger(customerId: number): CustomerLedgerEntry[];
}

