import { PurchaseRepository } from '../../infrastructure/sqlite/repositories/PurchaseRepository';
import { ProductRepository } from '../../infrastructure/sqlite/repositories/ProductRepository';
import { SupplierRepository } from '../../infrastructure/sqlite/repositories/SupplierRepository';
import { AccountRepository } from '../../infrastructure/sqlite/repositories/AccountRepository';
import { TransactionRunner } from '../../infrastructure/sqlite/transactions/transaction-runner';
import { LandedCostCalculator } from '../../domain/purchases/landed-cost';
import { StockLocationRules } from '../../domain/inventory/stock-location-rules';
import { StocktakeRules, StockLocationFrozenError, StocktakeSecurityError } from '../../domain/inventory/stocktake-rules';
import { StockBalanceRepository } from '../../infrastructure/sqlite/repositories/StockBalanceRepository';
import { InventoryValuationService } from './InventoryValuationService';
import { DoubleEntryLedger } from '../../domain/accounting/double-entry';
import { CreatePurchaseOrderRequest, PurchaseOrder } from '../../shared/types';
import { StockMovementType, StandardAccountCode } from '../../shared/constants/accounts';

export class PurchaseService {
  constructor(
    private purchaseRepo: PurchaseRepository = new PurchaseRepository(),
    private productRepo: ProductRepository = new ProductRepository(),
    private supplierRepo: SupplierRepository = new SupplierRepository(),
    private accountRepo: AccountRepository = new AccountRepository()
  ) {}

  public createPurchaseOrder(request: CreatePurchaseOrderRequest): number {
    if (!request.items || request.items.length === 0) {
      throw new Error('Purchase order must contain at least one item');
    }

    const supplier = this.supplierRepo.findById(request.supplierId);
    if (!supplier) throw new Error('Supplier not found');
    if (!supplier.isActive) {
      throw new Error(`Cannot purchase from inactive supplier '${supplier.name}'`);
    }

    const subtotal = request.items.reduce((sum, it) => sum + (it.quantity * it.unitCostPrice), 0);
    const grandTotal = subtotal + request.additionalCost;

    // Landed cost calculations
    const landedResults = LandedCostCalculator.calculateLandedCosts(
      request.items,
      request.additionalCost
    );

    const targetDb = (this.purchaseRepo as any)?.db || (this.productRepo as any)?.db;
    return TransactionRunner.run((db) => {
      // Step A0: Resolve and validate Stock Location (Prompt 11)
      let stockLoc: any = null;
      try {
        if (request.locationId) {
          stockLoc = db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(String(request.locationId));
        } else {
          stockLoc = db.prepare(`SELECT * FROM stock_locations WHERE is_default = 1 AND is_active = 1 LIMIT 1`).get();
        }
      } catch {}

      if (stockLoc) {
        StockLocationRules.validateReceivable({
          name: stockLoc.name,
          isActive: Boolean(stockLoc.is_active),
          isReceivable: Boolean(stockLoc.is_receivable)
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

      // 1. Create Purchase Order
      const poId = this.purchaseRepo.create({
        supplierId: request.supplierId,
        invoiceNumber: request.invoiceNumber,
        subtotal,
        additionalCost: request.additionalCost,
        grandTotal,
        amountPaid: request.amountPaid,
        notes: request.notes
      });

      // 2. Insert items and update product stock & cost price
      for (const item of request.items) {
        this.purchaseRepo.createItem(poId, item);

        const product = this.productRepo.findById(item.productId);
        if (product) {
          const landedInfo = landedResults.find(l => l.productId === item.productId);
          const effectiveUnitCost = landedInfo ? landedInfo.effectiveUnitCost : item.unitCostPrice;

          const addedBaseQty = item.quantity * item.conversionFactor;
          const oldStock = product.currentStock;
          const newStock = oldStock + addedBaseQty;

          // Moving average cost calculation
          let updatedCostPrice = effectiveUnitCost;
          if (oldStock > 0 && product.costPrice > 0) {
            const totalValue = (oldStock * product.costPrice) + (addedBaseQty * effectiveUnitCost);
            updatedCostPrice = Math.round(totalValue / newStock);
          }

          // Update product
          this.productRepo.updateStock(product.id, newStock);
          this.productRepo.update({
            ...product,
            currentStock: newStock,
            costPrice: updatedCostPrice,
            sellingPrice: item.sellingPrice > 0 ? item.sellingPrice : product.sellingPrice
          });

          if (stockLoc) {
            const balanceRepo = new StockBalanceRepository(db);
            const scaledQty = Math.round(addedBaseQty * 1000);
            balanceRepo.upsertDelta({
              businessId: stockLoc.business_id,
              productId: product.id,
              stockLocationId: stockLoc.id,
              onHandDeltaScaled: scaledQty
            });

            try {
              const valuationService = new InventoryValuationService(db);
              valuationService.processInboundReceipt({
                businessId: stockLoc.business_id,
                productId: product.id,
                stockLocationId: stockLoc.id,
                quantityScaled: scaledQty,
                unitCostMinor: effectiveUnitCost,
                currencyCode: 'PKR',
                sourceMovementId: String(poId)
              });
            } catch (vErr) {
              console.warn('[Valuation Inbound Warning]:', vErr);
            }
          }

          this.productRepo.logStockMovement({
            productId: product.id,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: addedBaseQty,
            previousStock: oldStock,
            newStock,
            stockLocationId: stockLoc?.id,
            referenceType: 'PURCHASE',
            referenceId: poId,
            reason: `Purchase receipt #${request.invoiceNumber}`
          });
        }
      }

      // 3. Update Supplier balance and ledger
      const unpaidBalance = grandTotal - request.amountPaid;
      if (grandTotal > 0) {
        this.supplierRepo.addLedgerEntry({
          supplierId: supplier.id,
          entryType: 'PURCHASE_BILL',
          referenceId: poId,
          debit: 0,
          credit: grandTotal,
          notes: `Bill #${request.invoiceNumber}`
        });

        if (request.amountPaid > 0) {
          this.supplierRepo.addLedgerEntry({
            supplierId: supplier.id,
            entryType: 'PAYMENT_DISBURSED',
            referenceId: poId,
            debit: request.amountPaid,
            credit: 0,
            notes: `Payment for Bill #${request.invoiceNumber}`
          });
        }
      }

      // 4. Double Entry posting
      const inventoryAccount = this.accountRepo.findByCode(StandardAccountCode.INVENTORY_ASSET);
      const payableAccount = this.accountRepo.findByCode(StandardAccountCode.ACCOUNTS_PAYABLE);
      const cashAccount = this.accountRepo.findByCode(StandardAccountCode.CASH_ON_HAND);

      if (inventoryAccount && payableAccount && cashAccount) {
        const lines = [
          {
            accountId: inventoryAccount.id,
            debit: grandTotal,
            credit: 0,
            memo: 'Inventory purchase'
          }
        ];

        if (request.amountPaid > 0) {
          lines.push({
            accountId: cashAccount.id,
            debit: 0,
            credit: request.amountPaid,
            memo: 'Cash paid to supplier'
          });
        }

        if (unpaidBalance > 0) {
          lines.push({
            accountId: payableAccount.id,
            debit: 0,
            credit: unpaidBalance,
            memo: 'Supplier accounts payable'
          });
        }

        const balanceCheck = DoubleEntryLedger.validateBalance(lines);
        if (balanceCheck.isBalanced) {
          this.accountRepo.createJournalEntry({
            entryNumber: `JE-PO-${request.invoiceNumber}`,
            referenceType: 'PURCHASE',
            referenceId: poId,
            description: `Purchase from ${supplier.name}`,
            totalAmount: grandTotal,
            lines
          });

          for (const l of lines) {
            const acc = this.accountRepo.findById(l.accountId);
            if (acc) {
              const updatedBal = DoubleEntryLedger.computeAccountBalance(acc.balance, acc.type, l.debit, l.credit);
              this.accountRepo.updateBalance(acc.id, updatedBal);
            }
          }
        }
      }

      return poId;
    }, targetDb);
  }

  public listPurchaseOrders(): PurchaseOrder[] {
    return this.purchaseRepo.list();
  }
}

