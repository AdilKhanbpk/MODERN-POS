import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { CustomerRepository } from '../../infrastructure/sqlite/repositories/CustomerRepository';
import { SaleRepository } from '../../infrastructure/sqlite/repositories/SaleRepository';
import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { PricingCalculator } from '../../domain/sales/pricing-calculator';
import { StockRules } from '../../domain/inventory/stock-rules';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { CreateSaleRequest, Sale, SaleCalculationResult, CartItemInput } from '../../shared/types';
import { PaymentMethod, StockMovementType, StandardAccountCode, AccountType } from '../../shared/constants/accounts';

export class SalesService {
  constructor(
    private saleRepo: SaleRepository = new SaleRepository(),
    private productRepo: ProductRepository = new ProductRepository(),
    private customerRepo: CustomerRepository = new CustomerRepository(),
    private accountRepo: AccountRepository = new AccountRepository()
  ) {}

  /**
   * Domain-only calculation preview for UI (UI never calculates final truth!).
   */
  public calculate(
    items: CartItemInput[],
    orderDiscountPercent = 0,
    orderDiscountAmount = 0
  ): SaleCalculationResult {
    return PricingCalculator.calculateSale(items, orderDiscountPercent, orderDiscountAmount);
  }

  /**
   * Processes a complete sale transaction with atomic inventory deduction and accounting ledger entries.
   */
  public createSale(request: CreateSaleRequest): Sale {
    if (!request.items || request.items.length === 0) {
      throw new Error('Sale must contain at least one item');
    }

    // 1. Calculate pricing via shared Domain Layer
    const calculation = PricingCalculator.calculateSale(
      request.items,
      request.orderDiscountPercent || 0,
      request.orderDiscountAmount || 0
    );

    // 2. Validate payment splits / credit
    const isCredit = request.paymentMethod === PaymentMethod.CREDIT;
    const splitPayment = PricingCalculator.calculatePaymentSplit(
      calculation.grandTotal,
      request.amountPaid,
      isCredit
    );

    // Check customer credit limit if credit is used
    if (splitPayment.customerBalanceChange > 0) {
      if (!request.customerId) {
        throw new Error('Customer must be selected for credit transactions');
      }
      const customer = this.customerRepo.findById(request.customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }
      if (customer.creditLimit > 0 && (customer.balance + splitPayment.customerBalanceChange > customer.creditLimit)) {
        throw new Error(`Credit limit exceeded! Allowed: ${customer.creditLimit / 100}, Attempted: ${(customer.balance + splitPayment.customerBalanceChange) / 100}`);
      }
    }

    // 3. Perform atomic database transaction
    return TransactionRunner.run((db) => {
      // Step A: Validate stock and deduct inventory
      for (const item of request.items) {
        const product = this.productRepo.findById(item.productId);
        if (!product) {
          throw new Error(`Product ID ${item.productId} not found`);
        }

        const baseQtyNeeded = item.quantity * item.conversionFactor;
        const validation = StockRules.validateAvailability(product.currentStock, baseQtyNeeded, false);
        if (!validation.isValid) {
          throw new Error(`Product '${product.name}' stock shortage: ${validation.message}`);
        }

        const newStock = StockRules.computeNewStock(
          product.currentStock,
          StockMovementType.SALE,
          baseQtyNeeded
        );

        this.productRepo.updateStock(product.id, newStock);
        this.productRepo.logStockMovement({
          productId: product.id,
          movementType: StockMovementType.SALE,
          quantity: baseQtyNeeded,
          previousStock: product.currentStock,
          newStock,
          referenceType: 'SALE',
          reason: 'Retail sale deduction',
          userId: request.cashierId
        });
      }

      // Step B: Generate Invoice Number and save Sale
      const invoiceNumber = this.saleRepo.getNextInvoiceNumber();
      const saleId = this.saleRepo.create({
        invoiceNumber,
        customerId: request.customerId,
        cashierId: request.cashierId,
        subtotal: calculation.subtotal,
        totalDiscount: calculation.totalDiscount,
        totalTax: calculation.totalTax,
        grandTotal: calculation.grandTotal,
        totalCost: calculation.totalCostPrice,
        profit: calculation.estimatedProfit,
        paymentMethod: request.paymentMethod,
        amountPaid: request.amountPaid,
        changeGiven: splitPayment.changeGiven,
        customerBalanceChange: splitPayment.customerBalanceChange,
        notes: request.notes
      });

      // Step C: Insert sale items
      for (const item of calculation.items) {
        const product = this.productRepo.findById(item.productId);
        this.saleRepo.createItem({
          saleId,
          productId: item.productId,
          productName: product ? product.name : 'Unknown Product',
          productBarcode: product ? product.barcode : '',
          unitName: item.unitName,
          quantity: item.quantity,
          conversionFactor: item.conversionFactor,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice,
          lineDiscount: item.lineDiscount,
          lineTax: item.lineTax,
          lineTotal: item.lineTotal,
          lineProfit: item.lineProfit
        });
      }

      // Step D: Update Customer Balance and Ledger if credit used
      if (request.customerId && splitPayment.customerBalanceChange > 0) {
        const customer = this.customerRepo.findById(request.customerId)!;
        const newBalance = customer.balance + splitPayment.customerBalanceChange;
        this.customerRepo.updateBalance(customer.id, newBalance);
        this.customerRepo.addLedgerEntry({
          customerId: customer.id,
          transactionType: 'SALE_CREDIT',
          referenceId: saleId,
          debit: splitPayment.customerBalanceChange,
          credit: 0,
          runningBalance: newBalance,
          notes: `Invoice ${invoiceNumber}`
        });
      }

      // Step E: Double-Entry General Ledger Posting
      const cashAccount = this.accountRepo.findByCode(StandardAccountCode.CASH_ON_HAND);
      const receivableAccount = this.accountRepo.findByCode(StandardAccountCode.ACCOUNTS_RECEIVABLE);
      const revenueAccount = this.accountRepo.findByCode(StandardAccountCode.SALES_REVENUE);
      const taxPayableAccount = this.accountRepo.findByCode(StandardAccountCode.SALES_TAX_PAYABLE);
      const cogsAccount = this.accountRepo.findByCode(StandardAccountCode.COST_OF_GOODS_SOLD);
      const inventoryAccount = this.accountRepo.findByCode(StandardAccountCode.INVENTORY_ASSET);

      if (cashAccount && receivableAccount && revenueAccount && taxPayableAccount && cogsAccount && inventoryAccount) {
        const journalLines = DoubleEntryLedger.createSaleJournalLines({
          cashAccountId: cashAccount.id,
          receivableAccountId: receivableAccount.id,
          salesRevenueAccountId: revenueAccount.id,
          taxPayableAccountId: taxPayableAccount.id,
          cogsAccountId: cogsAccount.id,
          inventoryAccountId: inventoryAccount.id,
          cashReceived: Math.min(calculation.grandTotal, request.amountPaid),
          creditAmount: splitPayment.customerBalanceChange,
          grossSales: calculation.grandTotal,
          salesTax: calculation.totalTax,
          costOfGoodsSold: calculation.totalCostPrice
        });

        // Verify balance
        const balanceCheck = DoubleEntryLedger.validateBalance(journalLines);
        if (!balanceCheck.isBalanced) {
          throw new Error(`Ledger entry out of balance by ${balanceCheck.discrepancy} cents`);
        }

        // Save journal entry
        this.accountRepo.createJournalEntry({
          entryNumber: `JE-${invoiceNumber}`,
          referenceType: 'SALE',
          referenceId: saleId,
          description: `Sale ${invoiceNumber}`,
          totalAmount: calculation.grandTotal,
          lines: journalLines
        });

        // Update Account running balances
        for (const line of journalLines) {
          const acc = this.accountRepo.findById(line.accountId);
          if (acc) {
            const updatedBalance = DoubleEntryLedger.computeAccountBalance(
              acc.balance,
              acc.type,
              line.debit,
              line.credit
            );
            this.accountRepo.updateBalance(acc.id, updatedBalance);
          }
        }
      }

      const createdSale = this.saleRepo.findById(saleId);
      if (!createdSale) {
        throw new Error('Failed to retrieve newly created sale');
      }
      return createdSale;
    });
  }

  public getSaleById(id: number): Sale | null {
    return this.saleRepo.findById(id);
  }

  public listSales(limit = 100): Sale[] {
    return this.saleRepo.list(limit);
  }

  public voidSale(id: number, cashierId: number): void {
    TransactionRunner.run((db) => {
      const sale = this.saleRepo.findById(id);
      if (!sale) throw new Error('Sale not found');
      if (sale.status === 'VOIDED') throw new Error('Sale is already voided');

      // Restore inventory
      if (sale.items) {
        for (const item of sale.items) {
          const product = this.productRepo.findById(item.productId);
          if (product) {
            const baseQty = item.quantity * item.conversionFactor;
            const newStock = product.currentStock + baseQty;
            this.productRepo.updateStock(product.id, newStock);
            this.productRepo.logStockMovement({
              productId: product.id,
              movementType: StockMovementType.SALE_RETURN,
              quantity: baseQty,
              previousStock: product.currentStock,
              newStock,
              referenceType: 'SALE_VOID',
              referenceId: sale.id,
              reason: `Sale ${sale.invoiceNumber} voided`,
              userId: cashierId
            });
          }
        }
      }

      // Revert customer balance if credit was extended
      if (sale.customerId && sale.customerBalanceChange > 0) {
        const customer = this.customerRepo.findById(sale.customerId);
        if (customer) {
          const newBalance = customer.balance - sale.customerBalanceChange;
          this.customerRepo.updateBalance(customer.id, newBalance);
          this.customerRepo.addLedgerEntry({
            customerId: customer.id,
            transactionType: 'SALE_VOID',
            referenceId: sale.id,
            debit: 0,
            credit: sale.customerBalanceChange,
            runningBalance: newBalance,
            notes: `Voided Invoice ${sale.invoiceNumber}`
          });
        }
      }

      this.saleRepo.voidSale(id);
    });
  }
}

