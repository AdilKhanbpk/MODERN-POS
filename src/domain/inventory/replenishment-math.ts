import { ReplenishmentUrgency } from '../../shared/types/stock-replenishment';

export interface PackagingRoundingResult {
  rawShortfallScaled: number;
  packagingFactorScaled: number;
  packagesCount: number;
  roundedQuantityScaled: number;
  explanation: string;
}

export class ReplenishmentMath {
  /**
   * Calculates simple replenishment shortfall:
   * ReorderQuantity = Math.max(0, TargetStock - AvailableStock)
   */
  public static calculateSimpleReorderQuantity(
    targetStockScaled: number,
    availableStockScaled: number
  ): number {
    return Math.max(0, targetStockScaled - availableStockScaled);
  }

  /**
   * Rounds up shortfall to whole packaging units (e.g. whole cartons).
   * Strictly avoids rounding down to prevent insufficient inventory recommendations.
   */
  public static roundUpToPackagingUnits(
    shortfallScaled: number,
    packagingFactorScaled: number,
    unitName: string = 'Carton'
  ): PackagingRoundingResult {
    if (shortfallScaled <= 0 || packagingFactorScaled <= 1000) {
      return {
        rawShortfallScaled: shortfallScaled,
        packagingFactorScaled: Math.max(1000, packagingFactorScaled),
        packagesCount: Math.ceil(shortfallScaled / 1000),
        roundedQuantityScaled: shortfallScaled,
        explanation: 'Single item base units (no packaging rounding required).'
      };
    }

    // Exact ceiling division using integer math
    const packagesCount = Math.ceil(shortfallScaled / packagingFactorScaled);
    const roundedQuantityScaled = packagesCount * packagingFactorScaled;

    const rawUnits = shortfallScaled / 1000;
    const factorUnits = packagingFactorScaled / 1000;
    const roundedUnits = roundedQuantityScaled / 1000;

    const explanation = `Supplier accepts whole ${unitName.toLowerCase()}s only. ${rawUnits} pieces rounded up to ${packagesCount} ${unitName.toLowerCase()}(s) (${roundedUnits} pieces).`;

    return {
      rawShortfallScaled: shortfallScaled,
      packagingFactorScaled,
      packagesCount,
      roundedQuantityScaled,
      explanation
    };
  }

  /**
   * Calculates dynamic reorder point:
   * ReorderPoint = (AverageDailyDemand * LeadTimeDays) + SafetyStock
   */
  public static calculateReorderPoint(
    averageDailyDemandScaled: number,
    leadTimeDays: number,
    safetyStockScaled: number
  ): number {
    const demandOverLeadTime = Math.round(averageDailyDemandScaled * Math.max(0, leadTimeDays));
    return demandOverLeadTime + Math.max(0, safetyStockScaled);
  }

  /**
   * Calculates average daily demand from net sales quantity over a historical period.
   * Period days must be >= 1.
   */
  public static calculateAverageDailyDemand(
    netSalesQuantityScaled: number,
    periodDays: number
  ): number {
    const validPeriod = Math.max(1, periodDays);
    const nonNegativeSales = Math.max(0, netSalesQuantityScaled);
    return Math.round(nonNegativeSales / validPeriod);
  }

  /**
   * Evaluates replenishment urgency category based on current stock levels and thresholds.
   */
  public static determineUrgency(
    availableStockScaled: number,
    minimumStockScaled: number,
    reorderPointScaled: number
  ): ReplenishmentUrgency {
    if (availableStockScaled <= 0) {
      return 'OUT_OF_STOCK';
    }
    if (minimumStockScaled > 0 && availableStockScaled < minimumStockScaled) {
      return 'BELOW_MINIMUM';
    }
    if (reorderPointScaled > 0 && availableStockScaled <= reorderPointScaled) {
      return 'BELOW_REORDER_POINT';
    }
    return 'ADEQUATE';
  }
}

