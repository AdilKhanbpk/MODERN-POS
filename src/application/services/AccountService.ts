import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { CustomerRepository } from '../../infrastructure/sqlite/repositories/CustomerRepository';
import { SupplierRepository } from '../../infrastructure/sqlite/repositories/SupplierRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { Account, JournalEntry, JournalEntryLine } from '../../shared/types';
import { StandardAccountCode } from '../../shared/constants/accounts';

export class AccountService {
  constructor(
    private accountRepo: AccountRepository = new AccountRepository(),
    private customerRepo: CustomerRepository = new CustomerRepository(),
    private supplierRepo: SupplierRepository = new SupplierRepository()
  ) {}

  public getAccounts(): Account[] {
    return this.accountRepo.list();
  }

  public getJournalEntries(limit = 100): JournalEntry[] {
    return this.accountRepo.listJournalEntries(limit);
  }

  public getTrialBalance(): any[] {
    return this.accountRepo.getTrialBalance();
  }

  public createManualJournalEntry(params: {
    description: string;
    lines: JournalEntryLine[];
  }): number {
    const balanceCheck = DoubleEntryLedger.validateBalance(params.lines);
    if (!balanceCheck.isBalanced) {
      throw new Error(`Unbalanced entry! Debits must equal Credits. Difference: ${balanceCheck.discrepancy} cents`);
    }

    const totalAmount = params.lines.reduce((s, l) => s + l.debit, 0);

    return TransactionRunner.run(() => {
      const entryNumber = `JE-MAN-${Date.now()}`;
      const entryId = this.accountRepo.createJournalEntry({
        entryNumber,
        referenceType: 'MANUAL',
        description: params.description,
        totalAmount,
        lines: params.lines
      });

      for (const line of params.lines) {
        const acc = this.accountRepo.findById(line.accountId);
        if (acc) {
          const newBal = DoubleEntryLedger.computeAccountBalance(acc.balance, acc.type, line.debit, line.credit);
          this.accountRepo.updateBalance(acc.id, newBal);
        }
      }

      return entryId;
    });
  }

  public recordCustomerPayment(params: {
    customerId: number;
    amountPaid: number; // in cents
    notes?: string;
  }): void {
    if (params.amountPaid <= 0) throw new Error('Payment amount must be greater than zero');

    TransactionRunner.run(() => {
      const customer = this.customerRepo.findById(params.customerId);
      if (!customer) throw new Error('Customer not found');

      const newBalance = customer.balance - params.amountPaid;
      this.customerRepo.updateBalance(customer.id, newBalance);
      this.customerRepo.addLedgerEntry({
        customerId: customer.id,
        transactionType: 'PAYMENT_RECEIVED',
        debit: 0,
        credit: params.amountPaid,
        runningBalance: newBalance,
        notes: params.notes || 'Customer dues payment received'
      });

      // Double-entry: Debit Cash, Credit Accounts Receivable
      const cashAcc = this.accountRepo.findByCode(StandardAccountCode.CASH_ON_HAND);
      const arAcc = this.accountRepo.findByCode(StandardAccountCode.ACCOUNTS_RECEIVABLE);

      if (cashAcc && arAcc) {
        const lines: JournalEntryLine[] = [
          { accountId: cashAcc.id, debit: params.amountPaid, credit: 0, memo: `Payment from ${customer.name}` },
          { accountId: arAcc.id, debit: 0, credit: params.amountPaid, memo: `A/R reduction for ${customer.name}` }
        ];

        this.accountRepo.createJournalEntry({
          entryNumber: `JE-CPAY-${Date.now()}`,
          referenceType: 'CUSTOMER_PAYMENT',
          referenceId: customer.id,
          description: `Customer payment: ${customer.name}`,
          totalAmount: params.amountPaid,
          lines
        });

        this.accountRepo.updateBalance(cashAcc.id, DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, params.amountPaid, 0));
        this.accountRepo.updateBalance(arAcc.id, DoubleEntryLedger.computeAccountBalance(arAcc.balance, arAcc.type, 0, params.amountPaid));
      }
    });
  }

  public recordSupplierPayment(params: {
    supplierId: number;
    amountPaid: number;
    notes?: string;
  }): void {
    if (params.amountPaid <= 0) throw new Error('Payment amount must be greater than zero');

    TransactionRunner.run(() => {
      const supplier = this.supplierRepo.findById(params.supplierId);
      if (!supplier) throw new Error('Supplier not found');

      const newBalance = supplier.balance - params.amountPaid;
      this.supplierRepo.updateBalance(supplier.id, newBalance);
      this.supplierRepo.addLedgerEntry({
        supplierId: supplier.id,
        transactionType: 'PAYMENT_MADE',
        debit: params.amountPaid,
        credit: 0,
        runningBalance: newBalance,
        notes: params.notes || 'Supplier payment disbursed'
      });

      // Double-entry: Debit Accounts Payable, Credit Cash
      const cashAcc = this.accountRepo.findByCode(StandardAccountCode.CASH_ON_HAND);
      const apAcc = this.accountRepo.findByCode(StandardAccountCode.ACCOUNTS_PAYABLE);

      if (cashAcc && apAcc) {
        const lines: JournalEntryLine[] = [
          { accountId: apAcc.id, debit: params.amountPaid, credit: 0, memo: `Payment to ${supplier.name}` },
          { accountId: cashAcc.id, debit: 0, credit: params.amountPaid, memo: `Cash disbursed for ${supplier.name}` }
        ];

        this.accountRepo.createJournalEntry({
          entryNumber: `JE-SPAY-${Date.now()}`,
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: supplier.id,
          description: `Supplier payment: ${supplier.name}`,
          totalAmount: params.amountPaid,
          lines
        });

        this.accountRepo.updateBalance(apAcc.id, DoubleEntryLedger.computeAccountBalance(apAcc.balance, apAcc.type, params.amountPaid, 0));
        this.accountRepo.updateBalance(cashAcc.id, DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, 0, params.amountPaid));
      }
    });
  }
}

