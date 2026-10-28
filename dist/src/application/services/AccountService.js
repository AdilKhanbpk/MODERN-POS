"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountService = void 0;
const AccountRepository_1 = require("../../infrastructure/sqlite/repositories/AccountRepository");
const CustomerRepository_1 = require("../../infrastructure/sqlite/repositories/CustomerRepository");
const SupplierRepository_1 = require("../../infrastructure/sqlite/repositories/SupplierRepository");
const transaction_runner_1 = require("../../infrastructure/sqlite/transactions/transaction-runner");
const double_entry_1 = require("../../domain/accounting/double-entry");
const accounts_1 = require("../../shared/constants/accounts");
class AccountService {
    accountRepo;
    customerRepo;
    supplierRepo;
    constructor(accountRepo = new AccountRepository_1.AccountRepository(), customerRepo = new CustomerRepository_1.CustomerRepository(), supplierRepo = new SupplierRepository_1.SupplierRepository()) {
        this.accountRepo = accountRepo;
        this.customerRepo = customerRepo;
        this.supplierRepo = supplierRepo;
    }
    getAccounts() {
        return this.accountRepo.list();
    }
    getJournalEntries(limit = 100) {
        return this.accountRepo.listJournalEntries(limit);
    }
    getTrialBalance() {
        return this.accountRepo.getTrialBalance();
    }
    createManualJournalEntry(params) {
        const balanceCheck = double_entry_1.DoubleEntryLedger.validateBalance(params.lines);
        if (!balanceCheck.isBalanced) {
            throw new Error(`Unbalanced entry! Debits must equal Credits. Difference: ${balanceCheck.discrepancy} cents`);
        }
        const totalAmount = params.lines.reduce((s, l) => s + l.debit, 0);
        return transaction_runner_1.TransactionRunner.run(() => {
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
                    const newBal = double_entry_1.DoubleEntryLedger.computeAccountBalance(acc.balance, acc.type, line.debit, line.credit);
                    this.accountRepo.updateBalance(acc.id, newBal);
                }
            }
            return entryId;
        });
    }
    recordCustomerPayment(params) {
        if (params.amountPaid <= 0)
            throw new Error('Payment amount must be greater than zero');
        transaction_runner_1.TransactionRunner.run(() => {
            const customer = this.customerRepo.findById(params.customerId);
            if (!customer)
                throw new Error('Customer not found');
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
            const cashAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.CASH_ON_HAND);
            const arAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.ACCOUNTS_RECEIVABLE);
            if (cashAcc && arAcc) {
                const lines = [
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
                this.accountRepo.updateBalance(cashAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, params.amountPaid, 0));
                this.accountRepo.updateBalance(arAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(arAcc.balance, arAcc.type, 0, params.amountPaid));
            }
        });
    }
    recordSupplierPayment(params) {
        if (params.amountPaid <= 0)
            throw new Error('Payment amount must be greater than zero');
        transaction_runner_1.TransactionRunner.run(() => {
            const supplier = this.supplierRepo.findById(params.supplierId);
            if (!supplier)
                throw new Error('Supplier not found');
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
            const cashAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.CASH_ON_HAND);
            const apAcc = this.accountRepo.findByCode(accounts_1.StandardAccountCode.ACCOUNTS_PAYABLE);
            if (cashAcc && apAcc) {
                const lines = [
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
                this.accountRepo.updateBalance(apAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(apAcc.balance, apAcc.type, params.amountPaid, 0));
                this.accountRepo.updateBalance(cashAcc.id, double_entry_1.DoubleEntryLedger.computeAccountBalance(cashAcc.balance, cashAcc.type, 0, params.amountPaid));
            }
        });
    }
}
exports.AccountService = AccountService;
