import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { CustomerRepository } from '../../infrastructure/sqlite/repositories/CustomerRepository';
import { SaleRepository } from '../../infrastructure/sqlite/repositories/SaleRepository';
import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { PricingCalculator } from '../../domain/sales/pricing-calculator';
import { StockRules } from '../../domain/inventory/stock-rules';
import { StockLocationRules } from '../../domain/inventory/stock-location-rules';
import { StocktakeRules, StockLocationFrozenError, StocktakeSecurityError } from '../../domain/inventory/stocktake-rules';
import { StockReservationRules, InsufficientAvailableStockError } from '../../domain/inventory/stock-reservation-rules';
import { StockReservationRepository } from '../../infrastructure/sqlite/repositories/StockReservationRepository';
import { StockReservationService } from './StockReservationService';
import { StockBalanceRepository } from '../../infrastructure/sqlite/repositories/StockBalanceRepository';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { CreateSaleRequest, Sale, SaleCalculationResult, CartItemInput } from '../../shared/types';
import { PaymentMethod, StockMovementType, StandardAccountCode, AccountType } from '../../shared/constants/accounts';
import { BatchAllocation } from '../../shared/types/batch-expiry';
import { BatchExpiryRules, BatchRequiredError, BatchNotFoundError, InsufficientBatchStockError } from '../../domain/inventory/batch-expiry-rules';
import { BatchExpiryService } from './BatchExpiryService';
import { ProductSerialNumber } from '../../shared/types/serial-tracking';
import {
  SerialRules,
  SerialRequiredError,
  SerialCountMismatchError,
  SerialAlreadySoldError
} from '../../domain/inventory/serial-rules';
import { SerialTrackingService } from './SerialTrackingService';
import { randomUUID } from 'crypto';

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
    const isCredit = Boolean(request.isCredit || request.paymentMethod === PaymentMethod.CREDIT);
    const splitPayment = PricingCalculator.calculatePaymentSplit(
      calculation.grandTotal,
      request.amountPaid,
      isCredit
    );

    // Resolve customer and check credit rules
    let effectiveCustomerId = request.customerId;

    if (splitPayment.customerBalanceChange > 0) {
      if (!effectiveCustomerId) {
        throw new Error('Customer must be selected for credit transactions');
      }
      const customer = this.customerRepo.findById(effectiveCustomerId);
      if (!customer) {
        throw new Error('Customer not found');
      }
      if (customer.isActive === false) {
        throw new Error(`Customer "${customer.name}" is inactive and cannot purchase on credit.`);
      }
      if (customer.customerCode === 'WALK-IN' || customer.name === 'Walk-in Customer') {
        throw new Error('Credit sales cannot be charged to the Walk-in customer account.');
      }
      if (customer.creditLimit > 0 && (customer.balance + splitPayment.customerBalanceChange > customer.creditLimit)) {
        throw new Error(`Credit limit exceeded! Allowed: ${customer.creditLimit / 100}, Attempted: ${(customer.balance + splitPayment.customerBalanceChange) / 100}`);
      }
    } else if (!effectiveCustomerId) {
      // Cash sale: default to Walk-in customer if not specified
      const walkIn = this.customerRepo.list().find(c => c.customerCode === 'WALK-IN');
      if (walkIn) {
        effectiveCustomerId = walkIn.id;
      }
    }

    // 3. Perform atomic database transaction
    const targetDb = (this.saleRepo as any)?.db || (this.productRepo as any)?.db;
    return TransactionRunner.run((db) => {
      // Step A0: Resolve and validate Stock Location (Prompt 11)
      let stockLoc: any = null;
      try {
        if (request.locationId) {
          stockLoc = db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(String(request.locationId));
        } else {
          if (request.counterId) {
            stockLoc = db.prepare(`
              SELECT l.* FROM counter_stock_locations csl
              JOIN stock_locations l ON csl.stock_location_id = l.id
              WHERE csl.counter_id = ? AND csl.is_default = 1 AND l.is_active = 1
            `).get(request.counterId);
          }
          if (!stockLoc && request.branchId) {
            stockLoc = db.prepare(`
              SELECT * FROM stock_locations
              WHERE branch_id = ? AND is_default = 1 AND is_active = 1
            `).get(request.branchId);
          }
          if (!stockLoc) {
            stockLoc = db.prepare(`
              SELECT * FROM stock_locations
              WHERE is_default = 1 AND is_active = 1
              LIMIT 1
            `).get();
          }
        }
      } catch {
        // Migration not yet applied or table unavailable
      }

      if (stockLoc) {
        StockLocationRules.validateSellable({
          name: stockLoc.name,
          isActive: Boolean(stockLoc.is_active),
          isSellable: Boolean(stockLoc.is_sellable),
          locationType: stockLoc.location_type
        });

        // Prompt 14 Policy A: Check Location Freeze
        try {
          const frozenRow = db.prepare(`
            SELECT id, stocktake_number FROM stocktakes
            WHERE stock_location_id = ?
              AND freeze_stock = 1
              AND status IN ('in_progress', 'count_submitted', 'review', 'approved')
            LIMIT 1
          `).get(stockLoc.id) as { id: string; stocktake_number: string } | undefined;

          if (frozenRow) {
            StocktakeRules.validateLocationFreeze(
              true,
              stockLoc.name,
              frozenRow.stocktake_number,
              Boolean((request as any).overrideFreeze || (request as any).overrideLocationFreeze),
              (request as any).userRole || (request as any).role
            );
          }
        } catch (err: any) {
          if (
            err instanceof StockLocationFrozenError ||
            err?.name === 'StockLocationFrozenError' ||
            err instanceof StocktakeSecurityError ||
            err?.name === 'StocktakeSecurityError'
          ) {
            throw err;
          }
        }
      }

      // Sweep expired reservations before evaluating stock availability
      try {
        const resService = new StockReservationService(db);
        resService.checkAndExpireReservations(stockLoc?.business_id);
      } catch {
        // Table or service may not be available in early isolated tests
      }

      let activeReservation: any = null;
      if (request.reservationId) {
        const resRepo = new StockReservationRepository(db);
        activeReservation = resRepo.findById(request.reservationId);
        if (!activeReservation) {
          throw new Error(`Reservation '${request.reservationId}' not found.`);
        }
        if (activeReservation.status === 'cancelled') {
          throw new Error(`Reservation '${activeReservation.reservationNumber}' is cancelled and cannot be fulfilled.`);
        }
        if (activeReservation.status === 'fulfilled') {
          throw new Error(`Reservation '${activeReservation.reservationNumber}' is already completely fulfilled.`);
        }
        if (activeReservation.status === 'expired' || StockReservationRules.isExpired(activeReservation.expiresAt)) {
          throw new Error(`Reservation '${activeReservation.reservationNumber}' is expired.`);
        }
      }

      // Step A: Validate stock and deduct inventory
      const itemBatchAllocationsMap = new Map<number, BatchAllocation[]>();
      const itemSerialAllocationsMap = new Map<number, ProductSerialNumber[]>();

      for (let itemIdx = 0; itemIdx < request.items.length; itemIdx++) {
        const item = request.items[itemIdx];
        const product = this.productRepo.findById(item.productId);
        if (!product) {
          throw new Error(`Product ID ${item.productId} not found`);
        }

        const baseQtyNeeded = item.quantity * item.conversionFactor;
        const baseQtyNeededScaled = Math.round(baseQtyNeeded * 1000);

        // Check if product requires batch tracking
        let batchSettings: any = null;
        try {
          batchSettings = db.prepare('SELECT * FROM product_batch_settings WHERE product_id = ?').get(String(product.id));
        } catch {
          // Table may not exist in early tests
        }

        const requiresBatch = Boolean(batchSettings?.requires_batch);
        let allocations: BatchAllocation[] = [];

        if (item.batchAllocations && item.batchAllocations.length > 0) {
          for (const alloc of item.batchAllocations) {
            const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(alloc.batchId) as any;
            if (!batch) throw new BatchNotFoundError(alloc.batchId);
            BatchExpiryRules.validateSaleBatchEligibility(batch, batchSettings ? {
              id: batchSettings.id,
              businessId: batchSettings.business_id,
              productId: batchSettings.product_id,
              requiresBatch: Boolean(batchSettings.requires_batch),
              requiresExpiry: Boolean(batchSettings.requires_expiry),
              expiryWarningDays: Number(batchSettings.expiry_warning_days),
              expirySalePolicy: batchSettings.expiry_sale_policy,
              batchCostPolicy: batchSettings.batch_cost_policy,
              createdAt: batchSettings.created_at,
              updatedAt: batchSettings.updated_at
            } : null);

            allocations.push({
              batchId: batch.id,
              batchNumber: batch.batch_number,
              expiryDate: batch.expiry_date,
              quantityScaled: alloc.quantityScaled,
              unitCostMinor: batch.cost_minor || 0
            });
          }
        } else if (item.batchId) {
          const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(item.batchId) as any;
          if (!batch) throw new BatchNotFoundError(item.batchId);
          BatchExpiryRules.validateSaleBatchEligibility(batch, batchSettings ? {
            id: batchSettings.id,
            businessId: batchSettings.business_id,
            productId: batchSettings.product_id,
            requiresBatch: Boolean(batchSettings.requires_batch),
            requiresExpiry: Boolean(batchSettings.requires_expiry),
            expiryWarningDays: Number(batchSettings.expiry_warning_days),
            expirySalePolicy: batchSettings.expiry_sale_policy,
            batchCostPolicy: batchSettings.batch_cost_policy,
            createdAt: batchSettings.created_at,
            updatedAt: batchSettings.updated_at
          } : null);

          allocations.push({
            batchId: batch.id,
            batchNumber: batch.batch_number,
            expiryDate: batch.expiry_date,
            quantityScaled: baseQtyNeededScaled,
            unitCostMinor: batch.cost_minor || 0
          });
        } else if (requiresBatch && stockLoc) {
          // Automated FEFO allocation
          const batchService = new BatchExpiryService(db);
          allocations = batchService.allocateBatchesForSale({
            businessId: stockLoc.business_id,
            productId: product.id,
            stockLocationId: stockLoc.id,
            requestedQuantityScaled: baseQtyNeededScaled
          });
        }

        if (requiresBatch && allocations.length === 0) {
          throw new BatchRequiredError(product.name);
        }

        if (allocations.length > 0) {
          const totalAllocated = allocations.reduce((s, a) => s + a.quantityScaled, 0);
          if (totalAllocated < baseQtyNeededScaled) {
            throw new InsufficientBatchStockError(
              allocations[0]?.batchNumber || 'Batch',
              baseQtyNeededScaled / 1000,
              totalAllocated / 1000
            );
          }

          if (stockLoc) {
            for (const alloc of allocations) {
              db.prepare(`
                UPDATE batch_stock_balances
                SET on_hand_scaled = on_hand_scaled - ?,
                    updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
                WHERE business_id = ? AND batch_id = ? AND stock_location_id = ?
              `).run(alloc.quantityScaled, stockLoc.business_id, alloc.batchId, stockLoc.id);
            }
          }

          itemBatchAllocationsMap.set(itemIdx, allocations);
        }

        // Check if product requires serial tracking
        let serialSettings: any = null;
        try {
          serialSettings = db.prepare('SELECT * FROM product_serial_settings WHERE product_id = ?').get(String(product.id));
        } catch {
          // Table may not exist in early tests
        }
        const requiresSerial = Boolean(serialSettings?.serial_tracking_required);

        if (requiresSerial) {
          const expectedCount = Math.round(baseQtyNeededScaled / 1000);
          const serialService = new SerialTrackingService(db);
          if (!item.serialNumbers || item.serialNumbers.length === 0) {
            throw new SerialRequiredError(product.name);
          }
          if (item.serialNumbers.length !== expectedCount) {
            throw new SerialCountMismatchError(product.name, expectedCount, item.serialNumbers.length);
          }
          const allocatedSerials = serialService.validateAndAllocateSaleSerials({
            businessId: stockLoc?.business_id || request.businessId || '00000000-0000-0000-0000-000000000001',
            productId: String(product.id),
            stockLocationId: stockLoc ? stockLoc.id : '00000000-0000-0000-0000-000000000001',
            quantityScaled: baseQtyNeededScaled,
            serials: item.serialNumbers
          });
          itemSerialAllocationsMap.set(itemIdx, allocatedSerials);
        }

        if (stockLoc) {
          const balanceRepo = new StockBalanceRepository(db);
          const balance = balanceRepo.getBalance(product.id, stockLoc.id, stockLoc.business_id);

          if (balance) {
            if (activeReservation) {
              const resLine = (activeReservation.lines || []).find(
                (l: any) => String(l.productId) === String(product.id) && l.stockLocationId === stockLoc.id
              );
              if (resLine) {
                StockReservationRules.validateFulfillment(activeReservation, resLine, baseQtyNeededScaled);
                const resRepo = new StockReservationRepository(db);
                resRepo.updateLineQuantities(resLine.id, baseQtyNeededScaled, 0);

                // Relieve reserved commitment
                balanceRepo.upsertDelta({
                  businessId: stockLoc.business_id,
                  productId: product.id,
                  stockLocationId: stockLoc.id,
                  onHandDeltaScaled: 0,
                  reservedDeltaScaled: -baseQtyNeededScaled
                });

                resLine.fulfilledQuantityScaled += baseQtyNeededScaled;
              } else {
                // Item is not on the reservation; evaluate against remaining available stock
                StockReservationRules.validateSaleAvailability(
                  product.name,
                  balance.onHandScaled,
                  balance.reservedScaled,
                  baseQtyNeededScaled
                );
              }
            } else {
              // Ordinary sale without reservation: strictly forbidden from consuming reserved stock
              StockReservationRules.validateSaleAvailability(
                product.name,
                balance.onHandScaled,
                balance.reservedScaled,
                baseQtyNeededScaled
              );
            }
          }
        }

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

        if (stockLoc) {
          const balanceRepo = new StockBalanceRepository(db);
          balanceRepo.upsertDelta({
            businessId: stockLoc.business_id,
            productId: product.id,
            stockLocationId: stockLoc.id,
            onHandDeltaScaled: -baseQtyNeededScaled
          });
        }

        this.productRepo.logStockMovement({
          productId: product.id,
          movementType: StockMovementType.SALE,
          quantity: baseQtyNeeded,
          previousStock: product.currentStock,
          newStock,
          stockLocationId: stockLoc?.id,
          referenceType: 'SALE',
          reason: activeReservation ? `Reservation ${activeReservation.reservationNumber} fulfillment` : 'Retail sale deduction',
          userId: request.cashierId
        });

        // Set batch_id on movement if batch allocated
        if (allocations.length > 0) {
          try {
            db.prepare(`
              UPDATE stock_movements
              SET batch_id = ?
              WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)
            `).run(allocations[0].batchId, product.id);
          } catch {
            // Safe fallback
          }
        }

        // Set serial_number_id on movement if serial allocated
        const serialAllocations = itemSerialAllocationsMap.get(itemIdx);
        if (serialAllocations && serialAllocations.length > 0) {
          try {
            db.prepare(`
              UPDATE stock_movements
              SET serial_number_id = ?
              WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)
            `).run(serialAllocations[0].id, product.id);
          } catch {
            // Safe fallback
          }
        }
      }

      // If fulfilling a reservation, evaluate whether it is now completely fulfilled
      if (activeReservation) {
        const resRepo = new StockReservationRepository(db);
        const refreshedRes = resRepo.findById(activeReservation.id);
        if (refreshedRes) {
          const allFulfilled = (refreshedRes.lines || []).every(
            (l) => (l.fulfilledQuantityScaled + l.releasedQuantityScaled) >= l.reservedQuantityScaled
          );
          const newStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';
          resRepo.updateStatus(activeReservation.id, newStatus);
        }
      }

      // Step B: Generate Invoice Number and save Sale
      const invoiceNumber = this.saleRepo.getNextInvoiceNumber();
      const saleId = this.saleRepo.create({
        invoiceNumber,
        customerId: effectiveCustomerId,
        cashierId: request.cashierId,
        subtotal: calculation.subtotal,
        totalDiscount: calculation.totalDiscount,
        totalTax: calculation.totalTax,
        grandTotal: calculation.grandTotal,
        totalCost: calculation.totalCostPrice,
        profit: calculation.estimatedProfit,
        paymentMethod: request.paymentMethod || (isCredit ? 'CREDIT' as any : 'CASH' as any),
        amountPaid: request.amountPaid,
        changeGiven: splitPayment.changeGiven,
        customerBalanceChange: splitPayment.customerBalanceChange,
        notes: request.notes
      });

      // Step C: Insert sale items
      for (let i = 0; i < calculation.items.length; i++) {
        const item = calculation.items[i];
        const product = this.productRepo.findById(item.productId);
        const saleItemId = this.saleRepo.createItem({
          saleId,
          productId: item.productId,
          productName: product ? product.name : 'Unknown Product',
          productBarcode: (product && product.barcode) ? product.barcode : (product?.sku || 'N/A'),
          unitName: item.unitName || 'Piece',
          quantity: item.quantity,
          conversionFactor: item.conversionFactor,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice ?? (product?.costPrice || (product as any)?.default_cost_minor || 0),
          lineDiscount: item.lineDiscount,
          lineTax: item.lineTax,
          lineTotal: item.lineTotal,
          lineProfit: item.lineProfit
        });

        const allocations = itemBatchAllocationsMap.get(i);
        if (allocations && allocations.length > 0 && saleItemId) {
          for (const alloc of allocations) {
            try {
              db.prepare(`
                INSERT INTO sale_item_batches (
                  id, business_id, sale_id, sale_item_id, product_id, batch_id, quantity_scaled, unit_cost_minor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
              `).run(
                randomUUID(),
                stockLoc?.business_id || '00000000-0000-0000-0000-000000000001',
                String(saleId),
                String(saleItemId),
                String(item.productId),
                alloc.batchId,
                alloc.quantityScaled,
                alloc.unitCostMinor || 0
              );
            } catch (sibErr) {
              console.error('[SaleItemBatches Insert Error]:', sibErr);
            }
          }
        }

        const serialAllocations = itemSerialAllocationsMap.get(i);
        if (serialAllocations && serialAllocations.length > 0 && saleItemId) {
          const serialService = new SerialTrackingService(db);
          serialService.claimSaleSerials(
            serialAllocations,
            saleId,
            saleItemId,
            stockLoc?.business_id || request.businessId || '00000000-0000-0000-0000-000000000001',
            request.cashierId
          );
        }
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
    }, targetDb);
  }

  public getSaleById(id: number): Sale | null {
    return this.saleRepo.findById(id);
  }

  public listSales(limit = 100): Sale[] {
    return this.saleRepo.list(limit);
  }

  public voidSale(id: number, cashierId: number): void {
    const targetDb = (this.saleRepo as any)?.db || (this.productRepo as any)?.db;
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
    }, targetDb);
  }
}

