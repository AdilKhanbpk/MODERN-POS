import { StockMovement, StockAdjustment, StockAdjustmentLine } from '../../types';
import { StockMovementType } from '../../constants/accounts';

export interface IStockRepository {
  recordMovement(movement: {
    productId: number;
    variantId?: number;
    locationId: number;
    batchId?: number;
    serialId?: number;
    movementType: StockMovementType | string;
    quantityBaseScaled: number;
    sourceType: string;
    sourceId: number;
    reason?: string;
    userId?: number;
  }): number;
  getStockBalance(productId: number, locationId?: number, variantId?: number, batchId?: number): number;
  createAdjustment(adj: {
    adjustmentNumber: string;
    locationId: number;
    reason: string;
    createdBy: number;
    lines: Array<{
      productId: number;
      variantId?: number;
      systemQtyScaled: number;
      countedQtyScaled: number;
      differenceQtyScaled: number;
    }>;
  }): number;
  getMovementsForProduct(productId: number, limit?: number): StockMovement[];
}

