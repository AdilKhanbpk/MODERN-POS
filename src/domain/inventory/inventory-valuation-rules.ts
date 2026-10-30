import {
  CostingMethod,
  BackdatingPolicy,
  NegativeStockPolicy
} from '../../shared/types/inventory-valuation';

export class ArbitraryCostMethodSwitchError extends Error {
  constructor(productName: string, currentMethod: string, requestedMethod: string) {
    super(
      `Cannot arbitrarily switch costing method for "${productName}" from "${currentMethod}" to "${requestedMethod}". A controlled inventory revaluation journal with managerial approval is required.`
    );
    this.name = 'ArbitraryCostMethodSwitchError';
    Object.setPrototypeOf(this, ArbitraryCostMethodSwitchError.prototype);
  }
}

export class UnauthorizedReturnValuationError extends Error {
  constructor(message = 'Customer returns without an original sales invoice reference require managerial approval and an explicit valuation policy.') {
    super(message);
    this.name = 'UnauthorizedReturnValuationError';
    Object.setPrototypeOf(this, UnauthorizedReturnValuationError.prototype);
  }
}

export class BackdatedPostingRestrictedError extends Error {
  constructor(productName: string, backdatedTime: string, latestTransactionTime: string) {
    super(
      `Backdated purchase for "${productName}" at ${backdatedTime} is restricted because subsequent outbound transactions exist up to ${latestTransactionTime}. The business accounting policy prohibits historical backdating after sales have posted.`
    );
    this.name = 'BackdatedPostingRestrictedError';
    Object.setPrototypeOf(this, BackdatedPostingRestrictedError.prototype);
  }
}

export class InventoryValuationRules {
  /**
   * Validates legal costing method.
   */
  public static validateCostMethod(method?: string): CostingMethod {
    if (!method) return 'weighted_average';
    const normalized = method.toLowerCase().trim();
    if (normalized === 'fifo' || normalized === 'weighted_average') {
      return normalized as CostingMethod;
    }
    throw new Error(`Invalid costing method "${method}". Supported methods: 'fifo', 'weighted_average'.`);
  }

  /**
   * Enforces that costing method cannot be switched arbitrarily on a product with existing stock.
   */
  public static validateCostMethodSwitch(params: {
    productName: string;
    currentMethod: CostingMethod;
    requestedMethod: CostingMethod;
    currentStockScaled: number;
    hasRevaluationApproval: boolean;
  }): void {
    const { productName, currentMethod, requestedMethod, currentStockScaled, hasRevaluationApproval } = params;

    if (currentMethod === requestedMethod) return;

    if (!hasRevaluationApproval) {
      throw new ArbitraryCostMethodSwitchError(productName, currentMethod, requestedMethod);
    }
  }

  /**
   * Validates customer return policy.
   * If return is linked to an original sale, allows restoration of original cost.
   * If return has NO sale reference, requires explicit manager authorization.
   */
  public static validateReturnValuation(params: {
    hasOriginalSale: boolean;
    actorRole?: string;
    isDamaged?: boolean;
    quarantineLocationId?: string;
    destinationLocationIsSellable?: boolean;
  }): void {
    const { hasOriginalSale, actorRole, isDamaged, destinationLocationIsSellable } = params;

    if (!hasOriginalSale) {
      const role = (actorRole || '').toLowerCase();
      const isAuthorized = role === 'manager' || role === 'owner' || role === 'admin' || role === 'administrator';
      if (!isAuthorized) {
        throw new UnauthorizedReturnValuationError(
          'Customer return without original invoice reference requires managerial override and an explicit return valuation.'
        );
      }
    }

    // Damaged goods must never be routed directly to sellable stock
    if (isDamaged && destinationLocationIsSellable) {
      throw new Error(
        'Damaged or unsellable returned goods must not be added to sellable stock. They must be routed to a designated quarantine or damaged stock location.'
      );
    }
  }

  /**
   * Validates backdated purchase policy.
   */
  public static validateBackdating(params: {
    productName: string;
    receiptTime: string;
    latestOutboundTime?: string | null;
    policy: BackdatingPolicy;
  }): void {
    const { productName, receiptTime, latestOutboundTime, policy } = params;

    if (!latestOutboundTime) return;

    const receiptDate = new Date(receiptTime).getTime();
    const latestOutboundDate = new Date(latestOutboundTime).getTime();

    if (receiptDate < latestOutboundDate && policy === 'restrict') {
      throw new BackdatedPostingRestrictedError(productName, receiptTime, latestOutboundTime);
    }
  }
}
