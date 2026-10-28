import { Supplier, SupplierLedgerEntry } from '../../types';

export interface ISupplierRepository {
  list(): Supplier[];
  findById(id: number): Supplier | null;
  search(query: string): Supplier[];
  create(supplier: {
    supplierCode?: string;
    name: string;
    contactPerson?: string;
    phone: string;
    email?: string;
    address?: string;
    openingBalanceMinor?: number;
    isActive?: boolean;
  }): number;
  addLedgerEntry(entry: {
    supplierId: number;
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
  calculateLedgerBalance(supplierId: number): number;
  reconcileBalance(supplierId: number): {
    isReconciled: boolean;
    cachedBalance: number;
    ledgerBalance: number;
    discrepancy: number;
  };
  getLedger(supplierId: number): SupplierLedgerEntry[];
}

