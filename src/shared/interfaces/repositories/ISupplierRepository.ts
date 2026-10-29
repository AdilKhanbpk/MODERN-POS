import { Supplier, SupplierLedgerEntry } from '../../types';

export interface ISupplierRepository {
  list(): Supplier[];
  findById(id: number | string): Supplier | null;
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
  }): number | string;
  addLedgerEntry(entry: {
    supplierId: number | string;
    entryType?: string;
    transactionType?: string;
    debitMinor?: number;
    debit?: number;
    creditMinor?: number;
    credit?: number;
    runningBalance?: number;
    sourceType?: string;
    sourceId?: number | string;
    referenceId?: number | string;
    notes?: string;
  }): number | string;
  calculateLedgerBalance(supplierId: number | string): number;
  reconcileBalance(supplierId: number | string): {
    isReconciled: boolean;
    cachedBalance: number;
    ledgerBalance: number;
    discrepancy: number;
  };
  getLedger(supplierId: number | string): SupplierLedgerEntry[];
}

