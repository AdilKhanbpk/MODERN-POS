import {
  ProductReorderRule,
  CalculationReason
} from '../../shared/types/stock-replenishment';

export class InactiveSupplierReplenishmentError extends Error {
  constructor(supplierName: string) {
    super(`Cannot generate purchase order for inactive supplier "${supplierName}".`);
    this.name = 'InactiveSupplierReplenishmentError';
  }
}

export class InvalidReorderRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReorderRuleError';
  }
}

export class ReplenishmentRuleValidationError extends InvalidReorderRuleError {}
export class TargetStockBelowMinimumError extends InvalidReorderRuleError {}

export class ReplenishmentRules {
  /**
   * Validates product reorder rule parameter integrity.
   */
  public static validateReorderRule(rule: Partial<ProductReorderRule>): void {
    const min = rule.minimumStockScaled || 0;
    const rop = rule.reorderPointScaled || 0;
    const target = rule.targetStockScaled || 0;
    const leadTime = rule.leadTimeDays || 0;
    const safety = rule.safetyStockScaled || 0;

    if (min < 0) {
      throw new ReplenishmentRuleValidationError(`Minimum stock cannot be negative.`);
    }
    if (rop < 0) {
      throw new ReplenishmentRuleValidationError(`Reorder point cannot be negative.`);
    }
    if (target < 0) {
      throw new ReplenishmentRuleValidationError(`Target stock cannot be negative.`);
    }
    if (target > 0 && min > 0 && target < min) {
      throw new TargetStockBelowMinimumError(
        `Target stock (${target / 1000}) cannot be less than minimum stock (${min / 1000}).`
      );
    }
    if (target > 0 && rop > 0 && target < rop) {
      throw new ReplenishmentRuleValidationError(
        `Target stock (${target / 1000}) cannot be less than reorder point (${rop / 1000}).`
      );
    }
    if (leadTime < 0) {
      throw new ReplenishmentRuleValidationError(`Supplier lead time days cannot be negative.`);
    }
    if (safety < 0) {
      throw new ReplenishmentRuleValidationError(`Safety stock cannot be negative.`);
    }
  }

  /**
   * Evaluates demand forecasting reliability and categorizes edge cases.
   */
  public static evaluateDemandForecast(params: {
    productCreatedAt: string;
    analysisPeriodDays: number;
    daysWithSales: number;
    totalNetSalesScaled: number;
    averageDailyDemandScaled: number;
    maxSingleDaySaleScaled: number;
  }): { confidence: 'HIGH' | 'MEDIUM' | 'LOW'; flags: string[] } {
    const {
      productCreatedAt,
      analysisPeriodDays,
      daysWithSales,
      totalNetSalesScaled,
      averageDailyDemandScaled,
      maxSingleDaySaleScaled
    } = params;

    const flags: string[] = [];

    // Check product age (new product < 14 days)
    const productAgeDays = Math.floor(
      (Date.now() - new Date(productCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (productAgeDays < 14) {
      flags.push('NEW_PRODUCT_LOW_HISTORY');
    }

    // Zero sales
    if (totalNetSalesScaled <= 0) {
      flags.push('ZERO_SALES');
      return { confidence: flags.includes('NEW_PRODUCT_LOW_HISTORY') ? 'LOW' : 'MEDIUM', flags };
    }

    // Outlier / Promotional spike detection: single day > 3x average
    if (averageDailyDemandScaled > 0 && maxSingleDaySaleScaled > averageDailyDemandScaled * 3) {
      flags.push('PROMOTION_SPIKE_DETECTED');
    }

    // Sparse sales (sold on fewer than 20% of days in period)
    const saleDaysRatio = daysWithSales / Math.max(1, analysisPeriodDays);
    if (saleDaysRatio < 0.2) {
      flags.push('IRREGULAR_DEMAND');
    }

    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
    if (flags.includes('NEW_PRODUCT_LOW_HISTORY') || flags.includes('IRREGULAR_DEMAND')) {
      confidence = 'LOW';
    } else if (flags.includes('PROMOTION_SPIKE_DETECTED')) {
      confidence = 'MEDIUM';
    }

    return { confidence, flags };
  }

  /**
   * Validates supplier status before converting replenishment suggestions to Purchase Order.
   */
  public static validateSupplierForConversion(supplier: { name: string; isActive?: boolean }): void {
    if (!supplier.isActive) {
      throw new InactiveSupplierReplenishmentError(supplier.name);
    }
  }
}
