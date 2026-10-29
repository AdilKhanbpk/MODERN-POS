import { ValidationError } from '../../shared/errors/AppError';
import { ProductPriceEntity } from '../../shared/types/product-catalogue';

export interface PriceInterval {
  id?: string;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * Checks whether two time intervals overlap.
 * Null represents unbounded time (-infinity for start, +infinity for end).
 */
export function doIntervalsOverlap(
  startA?: string | null,
  endA?: string | null,
  startB?: string | null,
  endB?: string | null
): boolean {
  const tStartA = startA ? new Date(startA).getTime() : -Infinity;
  const tEndA = endA ? new Date(endA).getTime() : Infinity;

  const tStartB = startB ? new Date(startB).getTime() : -Infinity;
  const tEndB = endB ? new Date(endB).getTime() : Infinity;

  if (tStartA > tEndA) {
    throw new ValidationError(`Invalid price validity range: validFrom (${startA}) cannot be after validTo (${endA}).`);
  }
  if (tStartB > tEndB) {
    throw new ValidationError(`Invalid price validity range: validFrom (${startB}) cannot be after validTo (${endB}).`);
  }

  return tStartA <= tEndB && tEndA >= tStartB;
}

/**
 * Asserts that a new or updated price record does not conflict with existing active prices
 * for the exact same (business_id, product_id, unit_id, price_type).
 */
export function assertNoPriceOverlap(
  candidate: PriceInterval,
  existingActivePrices: PriceInterval[]
): void {
  for (const existing of existingActivePrices) {
    if (candidate.id && existing.id === candidate.id) {
      continue; // Skip comparing against itself on updates
    }

    if (doIntervalsOverlap(candidate.validFrom, candidate.validTo, existing.validFrom, existing.validTo)) {
      throw new ValidationError(
        `Overlapping active price record detected for the same product, unit, and price type. ` +
        `Existing window: [${existing.validFrom || 'unbounded'}, ${existing.validTo || 'unbounded'}], ` +
        `New window: [${candidate.validFrom || 'unbounded'}, ${candidate.validTo || 'unbounded'}].`
      );
    }
  }
}

/**
 * Resolves the authoritative effective price for a product checkout line.
 * Filters by active status, matching unit, price type, quantity tier, and validity window.
 */
export function resolveEffectivePrice(
  prices: ProductPriceEntity[],
  unitId: string | number,
  priceType: string = 'retail',
  quantityScaled: number = 10000,
  targetDate: Date = new Date()
): ProductPriceEntity | null {
  const targetTime = targetDate.getTime();

  const matching = prices.filter(p => {
    if (!p.isActive) return false;
    if (String(p.unitId) !== String(unitId)) return false;
    if (p.priceType.toLowerCase() !== priceType.toLowerCase()) return false;
    if (p.minimumQuantityScaled > quantityScaled) return false;

    const tStart = p.validFrom ? new Date(p.validFrom).getTime() : -Infinity;
    const tEnd = p.validTo ? new Date(p.validTo).getTime() : Infinity;

    return targetTime >= tStart && targetTime <= tEnd;
  });

  if (matching.length === 0) {
    return null;
  }

  // Pick the highest tiered minimum_quantity_scaled (best volume discount match)
  matching.sort((a, b) => b.minimumQuantityScaled - a.minimumQuantityScaled);
  return matching[0];
}

