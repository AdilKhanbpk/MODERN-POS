import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getDatabase } from '../../infrastructure/sqlite/connection';
import {
  CostingMethod,
  InventoryCostLayer,
  InventoryCostAllocation,
  InventoryCostBalance,
  CostingSnapshot,
  InboundReceiptInput,
  OutboundIssueInput,
  CustomerReturnCostingInput,
  LandedCostAllocationInput,
  LandedCostAllocationResult,
  InventoryRevaluation,
  InventoryValuationReport,
  ValuationValuationLine,
  BackdatingPolicy
} from '../../shared/types/inventory-valuation';
import { ExactCostMath } from '../../domain/inventory/cost-math';
import {
  InventoryValuationRules,
  ArbitraryCostMethodSwitchError,
  UnauthorizedReturnValuationError,
  BackdatedPostingRestrictedError
} from '../../domain/inventory/inventory-valuation-rules';
import { LandedCostCalculator } from '../../domain/purchases/landed-cost';
import { InventoryCostRepository } from '../../infrastructure/sqlite/repositories/InventoryCostRepository';

export {
  ArbitraryCostMethodSwitchError,
  UnauthorizedReturnValuationError,
  BackdatedPostingRestrictedError
};

export class InventoryValuationService {
  private costRepo: InventoryCostRepository;

  constructor(private db: Database.Database = getDatabase()) {
    this.costRepo = new InventoryCostRepository(this.db);
  }

  public getDb(): Database.Database {
    return this.db;
  }

  /**
   * Resolves the authoritative costing method for a product:
   * 1. Product-level configured cost_method ('fifo' | 'weighted_average')
   * 2. Business-level default_cost_method fallback
   */
  public resolveCostMethod(businessId: string, productId: string | number): CostingMethod {
    const prodRow = this.db
      .prepare('SELECT cost_method FROM products WHERE id = ?')
      .get(productId) as { cost_method?: string } | undefined;

    if (prodRow?.cost_method) {
      return InventoryValuationRules.validateCostMethod(prodRow.cost_method);
    }

    const bizRow = this.db
      .prepare('SELECT default_cost_method FROM businesses WHERE id = ?')
      .get(businessId) as { default_cost_method?: string } | undefined;

    return InventoryValuationRules.validateCostMethod(bizRow?.default_cost_method || 'fifo');
  }

  /**
   * Resolves the backdating policy for a business.
   */
  public resolveBackdatingPolicy(businessId: string): BackdatingPolicy {
    const bizRow = this.db
      .prepare('SELECT backdating_policy FROM businesses WHERE id = ?')
      .get(businessId) as { backdating_policy?: string } | undefined;

    return (bizRow?.backdating_policy as BackdatingPolicy) || 'recalculate_adjustment';
  }

  /**
   * Inbound Stock Receipt Valuation:
   * - FIFO: creates a new layer in inventory_cost_layers.
   * - Weighted Average: recalculates weighted average unit cost and updates inventory_cost_balances.
   * - Settle any open provisional negative stock allocations.
   */
  public processInboundReceipt(input: InboundReceiptInput): {
    costingMethod: CostingMethod;
    unitCostMinor: number;
    layer?: InventoryCostLayer;
    balance?: InventoryCostBalance;
  } {
    const {
      businessId,
      productId,
      variantId,
      stockLocationId,
      quantityScaled,
      unitCostMinor,
      sourceMovementId,
      currencyCode = 'PKR'
    } = input;

    if (quantityScaled <= 0) {
      throw new Error(`Inbound receipt quantity must be greater than zero. Received: ${quantityScaled}`);
    }

    const costMethod = input.costMethod || this.resolveCostMethod(businessId, productId);
    const receivedAt = input.receivedAt || new Date().toISOString();

    let createdLayer: InventoryCostLayer | undefined;
    let updatedBalance: InventoryCostBalance | undefined;

    const tx = this.db.transaction(() => {
      // 1. Create FIFO Cost Layer (always tracked for FIFO, and for audit trail)
      createdLayer = this.costRepo.addCostLayer({
        businessId,
        productId,
        variantId,
        stockLocationId,
        sourceMovementId,
        receivedQuantityScaled: quantityScaled,
        remainingQuantityScaled: quantityScaled,
        unitCostMinor,
        currencyCode,
        receivedAt
      });

      // 2. If Weighted Average, recalculate running average balance
      if (costMethod === 'weighted_average') {
        const currentBalance = this.costRepo.getCostBalance(
          productId,
          stockLocationId,
          businessId,
          variantId
        );

        const receiptValue = ExactCostMath.calculateTotalCostMinor(quantityScaled, unitCostMinor);

        const calc = ExactCostMath.calculateWeightedAverage({
          oldQuantityScaled: currentBalance ? currentBalance.quantityScaled : 0,
          oldValueMinor: currentBalance ? currentBalance.inventoryValueMinor : 0,
          receivedQuantityScaled: quantityScaled,
          receivedValueMinor: receiptValue
        });

        updatedBalance = this.costRepo.upsertCostBalance({
          businessId,
          productId,
          variantId,
          stockLocationId,
          quantityScaled: calc.newQuantityScaled,
          inventoryValueMinor: calc.newValueMinor,
          averageUnitCostNumerator: calc.numerator,
          averageUnitCostDenominator: calc.denominator
        });
      }

      // 3. Negative stock reconciliation: check if there are open provisional allocations
      const openProvisional = this.costRepo.getOpenProvisionalAllocations(businessId, productId);
      if (openProvisional.length > 0) {
        for (const prov of openProvisional) {
          // Reconcile provisional cost with actual receipt cost
          this.db.prepare(`
            UPDATE inventory_cost_allocations
            SET unit_cost_minor = ?,
                allocated_cost_minor = ?,
                cost_layer_id = COALESCE(?, cost_layer_id),
                is_provisional = 0
            WHERE id = ?
          `).run(
            unitCostMinor,
            ExactCostMath.calculateTotalCostMinor(prov.quantityScaled, unitCostMinor),
            createdLayer ? createdLayer.id : null,
            prov.id
          );

          if (createdLayer) {
            this.costRepo.depleteCostLayer(createdLayer.id, prov.quantityScaled);
          }
        }
      }
    });

    tx();

    return {
      costingMethod: costMethod,
      unitCostMinor,
      layer: createdLayer,
      balance: updatedBalance
    };
  }

  /**
   * Outbound Issue Valuation (Sales, Transfers-Out, Adjustments, Damage Write-Offs):
   * Allocates cost from eligible layers (FIFO) or running average (Weighted Average).
   * Generates immutable CostingSnapshot with allocated COGS and profit impact.
   */
  public processOutboundIssue(input: OutboundIssueInput): CostingSnapshot {
    const {
      businessId,
      productId,
      variantId,
      stockLocationId,
      quantityScaled,
      referenceType,
      referenceId,
      referenceLineId,
      outboundMovementId,
      allowNegativeStock = false
    } = input;

    if (quantityScaled <= 0) {
      throw new Error(`Outbound quantity must be strictly greater than zero. Received: ${quantityScaled}`);
    }

    const costMethod = input.costMethod || this.resolveCostMethod(businessId, productId);
    const now = new Date().toISOString();

    const allocations: InventoryCostAllocation[] = [];
    let totalCogsMinor = 0;
    let isProvisional = false;

    const tx = this.db.transaction(() => {
      if (costMethod === 'fifo') {
        // --- FIFO DEPLETION ---
        const activeLayers = this.costRepo.getActiveCostLayers(
          productId,
          stockLocationId,
          businessId,
          variantId
        );

        let remainingToDeplete = quantityScaled;

        for (const layer of activeLayers) {
          if (remainingToDeplete <= 0) break;

          const takeQty = Math.min(layer.remainingQuantityScaled, remainingToDeplete);
          const lineCostMinor = ExactCostMath.calculateTotalCostMinor(takeQty, layer.unitCostMinor);

          this.costRepo.depleteCostLayer(layer.id, takeQty);

          const alloc = this.costRepo.createCostAllocation({
            businessId,
            outboundMovementId,
            costLayerId: layer.id,
            referenceType,
            referenceId,
            referenceLineId,
            quantityScaled: takeQty,
            unitCostMinor: layer.unitCostMinor,
            allocatedCostMinor: lineCostMinor,
            isProvisional: false
          });

          allocations.push(alloc);
          totalCogsMinor += lineCostMinor;
          remainingToDeplete -= takeQty;
        }

        // Handle case where inventory was insufficient to cover quantity
        if (remainingToDeplete > 0) {
          if (!allowNegativeStock) {
            const prodRow = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as any;
            throw new Error(
              `Insufficient inventory layers to cost outbound issue of ${quantityScaled / 1000} units for "${prodRow?.name || productId}". Negative stock is disabled.`
            );
          }

          // Negative stock enabled: record provisional allocation using fallback cost
          isProvisional = true;
          const fallbackRow = this.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(productId) as any;
          const fallbackUnitCost = fallbackRow?.cost_price || 0;
          const provCost = ExactCostMath.calculateTotalCostMinor(remainingToDeplete, fallbackUnitCost);

          const provAlloc = this.costRepo.createCostAllocation({
            businessId,
            productId,
            stockLocationId,
            outboundMovementId,
            costLayerId: null,
            referenceType,
            referenceId,
            referenceLineId,
            quantityScaled: remainingToDeplete,
            unitCostMinor: fallbackUnitCost,
            allocatedCostMinor: provCost,
            isProvisional: true
          });

          allocations.push(provAlloc);
          totalCogsMinor += provCost;
        }
      } else {
        // --- WEIGHTED AVERAGE DEPLETION ---
        const balance = this.costRepo.getCostBalance(
          productId,
          stockLocationId,
          businessId,
          variantId
        );

        let unitCost = 0;
        let cogs = 0;

        if (balance && balance.quantityScaled > 0 && balance.averageUnitCostDenominator > 0) {
          unitCost = Math.round((balance.averageUnitCostNumerator * 1000) / balance.averageUnitCostDenominator);
          cogs = Math.round((balance.averageUnitCostNumerator * quantityScaled) / balance.averageUnitCostDenominator);

          const newQty = balance.quantityScaled - quantityScaled;
          const newVal = Math.max(0, balance.inventoryValueMinor - cogs);

          this.costRepo.upsertCostBalance({
            businessId,
            productId,
            variantId,
            stockLocationId,
            quantityScaled: newQty,
            inventoryValueMinor: newVal,
            averageUnitCostNumerator: newVal,
            averageUnitCostDenominator: Math.max(1, newQty)
          });
        } else {
          // No balance or negative stock
          if (!allowNegativeStock) {
            const prodRow = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as any;
            throw new Error(
              `Insufficient stock balance to cost outbound issue for "${prodRow?.name || productId}". Available: ${balance ? balance.quantityScaled / 1000 : 0}. Negative stock is disabled.`
            );
          }

          isProvisional = true;
          const fallbackRow = this.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(productId) as any;
          unitCost = fallbackRow?.cost_price || 0;
          cogs = ExactCostMath.calculateTotalCostMinor(quantityScaled, unitCost);
        }

        const alloc = this.costRepo.createCostAllocation({
          businessId,
          productId,
          stockLocationId,
          outboundMovementId,
          costLayerId: null,
          referenceType,
          referenceId,
          referenceLineId,
          quantityScaled,
          unitCostMinor: unitCost,
          allocatedCostMinor: cogs,
          isProvisional
        });

        allocations.push(alloc);
        totalCogsMinor = cogs;
      }
    });

    tx();

    const unitCostMinor = quantityScaled > 0
      ? ExactCostMath.calculateUnitCostMinor(totalCogsMinor, quantityScaled)
      : 0;

    return {
      costingMethod: costMethod,
      costedQuantityScaled: quantityScaled,
      totalCogsMinor,
      unitCostMinor,
      allocations,
      calculatedAt: now,
      currencyCode: 'PKR',
      isProvisional
    };
  }

  /**
   * Customer Return Costing:
   * - Linked to original sale: restores original cost layers/allocations rather than using current average.
   * - Damaged goods: routed to quarantine location, keeping sellable stock unaffected.
   * - Return without invoice reference: requires manager authorization.
   */
  public processCustomerReturn(input: CustomerReturnCostingInput): {
    restoredCostMinor: number;
    unitCostMinor: number;
    layer?: InventoryCostLayer;
  } {
    const {
      businessId,
      saleId,
      saleItemId,
      productId,
      variantId,
      stockLocationId,
      returnedQuantityScaled,
      isDamaged,
      quarantineLocationId,
      overrideUnitCostMinor,
      actorRole
    } = input;

    // Check location sellable status
    const targetLocationId = isDamaged && quarantineLocationId ? quarantineLocationId : stockLocationId;
    const destLoc = this.db.prepare('SELECT is_sellable FROM stock_locations WHERE id = ?').get(targetLocationId) as any;

    InventoryValuationRules.validateReturnValuation({
      hasOriginalSale: Boolean(saleId || saleItemId),
      actorRole,
      isDamaged,
      quarantineLocationId,
      destinationLocationIsSellable: Boolean(destLoc?.is_sellable)
    });

    let effectiveUnitCostMinor = 0;

    // 1. Determine cost to restore
    if (saleId || saleItemId) {
      // Find original allocations for this sale item
      const refId = String(saleId);
      const refLineId = saleItemId ? String(saleItemId) : undefined;
      const originalAllocations = this.costRepo.getAllocationsByReference(
        businessId,
        'SALE',
        refId,
        refLineId
      );

      if (originalAllocations.length > 0) {
        // Weighted original unit cost from the allocations
        const totalAllocCost = originalAllocations.reduce((sum, a) => sum + a.allocatedCostMinor, 0);
        const totalAllocQty = originalAllocations.reduce((sum, a) => sum + a.quantityScaled, 0);
        effectiveUnitCostMinor = totalAllocQty > 0
          ? Math.round((totalAllocCost * 1000) / totalAllocQty)
          : originalAllocations[0].unitCostMinor;
      }
    }

    if (effectiveUnitCostMinor === 0) {
      if (overrideUnitCostMinor !== undefined && overrideUnitCostMinor > 0) {
        effectiveUnitCostMinor = overrideUnitCostMinor;
      } else {
        const prod = this.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(productId) as any;
        effectiveUnitCostMinor = prod?.cost_price || 0;
      }
    }

    // 2. Re-inject into inventory as restored cost layer
    const inbound = this.processInboundReceipt({
      businessId,
      productId,
      variantId,
      stockLocationId: targetLocationId,
      quantityScaled: returnedQuantityScaled,
      unitCostMinor: effectiveUnitCostMinor,
      costMethod: input.costMethod
    });

    const restoredCostMinor = ExactCostMath.calculateTotalCostMinor(
      returnedQuantityScaled,
      effectiveUnitCostMinor
    );

    return {
      restoredCostMinor,
      unitCostMinor: effectiveUnitCostMinor,
      layer: inbound.layer
    };
  }

  /**
   * Sale Cancellation Cost Reversal:
   * Restores depleted FIFO layers or updates Weighted Average balance.
   */
  public reverseSaleCosting(saleId: string | number, businessId: string): void {
    const allocations = this.costRepo.getAllocationsByReference(businessId, 'SALE', String(saleId));

    const tx = this.db.transaction(() => {
      for (const alloc of allocations) {
        if (alloc.costLayerId) {
          // Restore layer remaining quantity
          this.costRepo.restoreCostLayer(alloc.costLayerId, alloc.quantityScaled);
        }
      }

      // Mark allocations as reversed / delete allocations
      this.db.prepare(`
        DELETE FROM inventory_cost_allocations
        WHERE business_id = ? AND reference_type = 'SALE' AND reference_id = ?
      `).run(businessId, String(saleId));
    });

    tx();
  }

  /**
   * Apportions Landed Costs to purchased items using configured allocation method:
   * (Quantity, Weight, Value, or Manual).
   */
  public allocateLandedCosts(input: LandedCostAllocationInput): LandedCostAllocationResult {
    return LandedCostCalculator.allocateLandedCosts(input);
  }

  /**
   * Backdated Receipt Processing:
   * Resolves backdating policy (RESTRICT vs RECALCULATE_ADJUSTMENT).
   * Generates valuation adjustment if subsequent sales exist, without altering historical sales invoices.
   */
  public processBackdatedReceipt(params: {
    businessId: string;
    productId: string | number;
    stockLocationId: string;
    quantityScaled: number;
    unitCostMinor: number;
    receiptTime: string;
    actorUserId: string | number;
  }): {
    success: boolean;
    revaluation?: InventoryRevaluation;
    varianceMinor: number;
  } {
    const { businessId, productId, stockLocationId, quantityScaled, unitCostMinor, receiptTime, actorUserId } = params;

    const prodRow = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as any;
    const policy = this.resolveBackdatingPolicy(businessId);
    const latestOutbound = this.costRepo.getLatestOutboundTime(businessId, productId, stockLocationId);

    // Validate backdating policy
    InventoryValuationRules.validateBackdating({
      productName: prodRow?.name || String(productId),
      receiptTime,
      latestOutboundTime: latestOutbound,
      policy
    });

    let revaluation: InventoryRevaluation | undefined;
    let varianceMinor = 0;

    const tx = this.db.transaction(() => {
      // 1. Process the receipt with its historical receipt time
      const receipt = this.processInboundReceipt({
        businessId,
        productId,
        stockLocationId,
        quantityScaled,
        unitCostMinor,
        receivedAt: receiptTime
      });

      // 2. If backdated after subsequent sales, calculate valuation adjustment
      if (latestOutbound && new Date(receiptTime).getTime() < new Date(latestOutbound).getTime()) {
        // Calculate difference in current inventory value
        const currentBal = this.costRepo.getCostBalance(productId, stockLocationId, businessId);
        const oldVal = currentBal ? currentBal.inventoryValueMinor : 0;
        const newVal = oldVal + ExactCostMath.calculateTotalCostMinor(quantityScaled, unitCostMinor);
        varianceMinor = newVal - oldVal;

        revaluation = this.costRepo.recordRevaluation({
          businessId,
          productId,
          stockLocationId,
          oldCostMethod: this.resolveCostMethod(businessId, productId),
          newCostMethod: this.resolveCostMethod(businessId, productId),
          oldInventoryValueMinor: oldVal,
          newInventoryValueMinor: newVal,
          revaluationVarianceMinor: varianceMinor,
          reason: `Backdated purchase valuation adjustment for receipt at ${receiptTime}`,
          approvedBy: String(actorUserId)
        });
      }
    });

    tx();

    return {
      success: true,
      revaluation,
      varianceMinor
    };
  }

  /**
   * Controlled Inventory Revaluation & Cost Method Switch (FIFO <-> Weighted Average):
   * Enforces managerial approval, calculates revaluation variance, and updates layers/balances.
   */
  public revalueInventory(params: {
    businessId: string;
    productId: string | number;
    stockLocationId: string;
    newCostMethod: CostingMethod;
    reason: string;
    approvedBy: string;
  }): InventoryRevaluation {
    const { businessId, productId, stockLocationId, newCostMethod, reason, approvedBy } = params;

    const prod = this.db.prepare('SELECT name, cost_method, current_stock FROM products WHERE id = ?').get(productId) as any;
    if (!prod) throw new Error(`Product "${productId}" not found.`);

    const currentMethod = this.resolveCostMethod(businessId, productId);
    InventoryValuationRules.validateCostMethodSwitch({
      productName: prod.name,
      currentMethod,
      requestedMethod: newCostMethod,
      currentStockScaled: Math.round((prod.current_stock || 0) * 1000),
      hasRevaluationApproval: Boolean(approvedBy)
    });

    let oldVal = 0;
    let newVal = 0;

    const tx = this.db.transaction(() => {
      // 1. Calculate old inventory value
      if (currentMethod === 'fifo') {
        const layers = this.costRepo.getActiveCostLayers(productId, stockLocationId, businessId);
        oldVal = layers.reduce(
          (sum, l) => sum + ExactCostMath.calculateTotalCostMinor(l.remainingQuantityScaled, l.unitCostMinor),
          0
        );
      } else {
        const bal = this.costRepo.getCostBalance(productId, stockLocationId, businessId);
        oldVal = bal ? bal.inventoryValueMinor : 0;
      }

      // 2. Calculate new inventory value under requested method
      if (newCostMethod === 'weighted_average') {
        const layers = this.costRepo.getActiveCostLayers(productId, stockLocationId, businessId);
        const totalQty = layers.reduce((sum, l) => sum + l.remainingQuantityScaled, 0);
        newVal = oldVal; // Value preserved, average computed
        const unitCost = totalQty > 0 ? Math.round((newVal * 1000) / totalQty) : 0;

        this.costRepo.upsertCostBalance({
          businessId,
          productId,
          stockLocationId,
          quantityScaled: totalQty,
          inventoryValueMinor: newVal,
          averageUnitCostNumerator: newVal,
          averageUnitCostDenominator: totalQty
        });
      } else {
        // Switching to FIFO from Weighted Average
        const bal = this.costRepo.getCostBalance(productId, stockLocationId, businessId);
        if (bal && bal.quantityScaled > 0) {
          const unitCost = Math.round((bal.averageUnitCostNumerator * 1000) / bal.averageUnitCostDenominator);
          newVal = bal.inventoryValueMinor;

          // Create consolidated opening FIFO layer
          this.costRepo.addCostLayer({
            businessId,
            productId,
            stockLocationId,
            receivedQuantityScaled: bal.quantityScaled,
            remainingQuantityScaled: bal.quantityScaled,
            unitCostMinor: unitCost
          });
        }
      }

      // 3. Update product cost_method
      this.db.prepare('UPDATE products SET cost_method = ? WHERE id = ?').run(newCostMethod, productId);
    });

    tx();

    const variance = newVal - oldVal;

    return this.costRepo.recordRevaluation({
      businessId,
      productId,
      stockLocationId,
      oldCostMethod: currentMethod,
      newCostMethod,
      oldInventoryValueMinor: oldVal,
      newInventoryValueMinor: newVal,
      revaluationVarianceMinor: variance,
      reason,
      approvedBy
    });
  }

  /**
   * Generates comprehensive inventory valuation report:
   * Aggregates inventory values across products, cost methods, and stock locations.
   */
  public getValuationReport(businessId: string, locationId?: string): InventoryValuationReport {
    let sql = `
      SELECT DISTINCT
        p.id as product_id,
        p.name as product_name,
        p.sku,
        p.cost_method,
        l.id as stock_location_id,
        l.name as location_name,
        COALESCE(b.on_hand_scaled, 0) as stock_balance_qty
      FROM products p
      CROSS JOIN stock_locations l
      LEFT JOIN stock_balances b ON p.id = b.product_id AND b.stock_location_id = l.id
      LEFT JOIN inventory_cost_layers cl ON cl.product_id = p.id AND cl.stock_location_id = l.id AND cl.remaining_quantity_scaled > 0
      LEFT JOIN inventory_cost_balances cb ON cb.product_id = p.id AND cb.stock_location_id = l.id AND cb.quantity_scaled > 0
      WHERE p.business_id = ?
        AND (COALESCE(b.on_hand_scaled, 0) > 0 OR cl.id IS NOT NULL OR cb.id IS NOT NULL)
    `;
    const params: any[] = [businessId];

    if (locationId) {
      sql += ' AND l.id = ?';
      params.push(locationId);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];

    let totalInventoryValue = 0;
    const lines: ValuationValuationLine[] = [];

    for (const row of rows) {
      const method = (row.cost_method as CostingMethod) || 'weighted_average';
      let lineValue = 0;
      let unitCost = 0;
      let quantityScaled = 0;

      if (method === 'fifo') {
        const layers = this.costRepo.getActiveCostLayers(row.product_id, row.stock_location_id, businessId);
        lineValue = layers.reduce(
          (sum, l) => sum + ExactCostMath.calculateTotalCostMinor(l.remainingQuantityScaled, l.unitCostMinor),
          0
        );
        const qty = layers.reduce((sum, l) => sum + l.remainingQuantityScaled, 0);
        quantityScaled = qty > 0 ? qty : Number(row.stock_balance_qty);
        unitCost = quantityScaled > 0 ? Math.round((lineValue * 1000) / quantityScaled) : 0;
      } else {
        const bal = this.costRepo.getCostBalance(row.product_id, row.stock_location_id, businessId);
        lineValue = bal ? bal.inventoryValueMinor : 0;
        quantityScaled = bal && bal.quantityScaled > 0 ? bal.quantityScaled : Number(row.stock_balance_qty);
        unitCost = (bal && bal.averageUnitCostDenominator > 0)
          ? Math.round((bal.averageUnitCostNumerator * 1000) / bal.averageUnitCostDenominator)
          : (quantityScaled > 0 ? Math.round((lineValue * 1000) / quantityScaled) : 0);
      }

      if (quantityScaled > 0 || lineValue > 0) {
        totalInventoryValue += lineValue;
        lines.push({
          productId: row.product_id,
          productName: row.product_name,
          sku: row.sku,
          costMethod: method,
          quantityScaled,
          unitCostMinor: unitCost,
          totalValueMinor: lineValue
        });
      }
    }

    return {
      businessId,
      stockLocationId: locationId,
      currencyCode: 'PKR',
      totalInventoryValueMinor: totalInventoryValue,
      totalItemsCount: lines.length,
      generatedAt: new Date().toISOString(),
      lines
    };
  }
}
