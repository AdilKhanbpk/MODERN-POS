/**
 * Pure Domain Rules & Invariants for Stock Locations & Warehouses (Prompt 11)
 * Zero external I/O or SQLite dependencies.
 */

export class CircularHierarchyError extends Error {
  constructor(message = 'Circular location hierarchy detected. A location cannot be an ancestor of itself.') {
    super(message);
    this.name = 'CircularHierarchyError';
  }
}

export class LocationHasStockError extends Error {
  constructor(message = 'Cannot archive location containing non-zero stock. Transfer or adjust stock first.') {
    super(message);
    this.name = 'LocationHasStockError';
  }
}

export class LocationHasReservedStockError extends Error {
  constructor(message = 'Cannot archive location containing reserved stock.') {
    super(message);
    this.name = 'LocationHasReservedStockError';
  }
}

export class LocationNotSellableError extends Error {
  constructor(message = 'Cannot fulfil sales from this location because it is marked as non-sellable, damaged, or in quarantine.') {
    super(message);
    this.name = 'LocationNotSellableError';
  }
}

export class LocationNotReceivableError extends Error {
  constructor(message = 'Cannot receive inventory into this location because it is marked as non-receivable.') {
    super(message);
    this.name = 'LocationNotReceivableError';
  }
}

export class LocationInactiveError extends Error {
  constructor(message = 'This stock location is inactive and cannot participate in inventory transactions.') {
    super(message);
    this.name = 'LocationInactiveError';
  }
}

export class CrossBusinessLocationError extends Error {
  constructor(message = 'Cross-business location reference is strictly prohibited.') {
    super(message);
    this.name = 'CrossBusinessLocationError';
  }
}

export class CrossBranchTransferMismatchError extends Error {
  constructor(message = 'Inter-branch transfers must use the explicit branch transfer workflow rather than an internal warehouse transfer.') {
    super(message);
    this.name = 'CrossBranchTransferMismatchError';
  }
}

export interface LocationHierarchyNode {
  id: string;
  businessId: string;
  branchId: string;
  parentLocationId?: string | null;
}

export class StockLocationRules {
  /**
   * Ensures that setting a parent location does not create a circular reference
   * and that parent belongs to the same business and branch.
   */
  public static validateHierarchy(
    locationId: string | null,
    newParentId: string | null | undefined,
    lookupParentFn: (id: string) => LocationHierarchyNode | null | undefined,
    targetBranchId: string,
    targetBusinessId: string
  ): void {
    if (!newParentId) return;

    if (locationId && newParentId === locationId) {
      throw new CircularHierarchyError('A location cannot be its own parent.');
    }

    const parent = lookupParentFn(newParentId);
    if (!parent) {
      throw new Error(`Parent location "${newParentId}" not found.`);
    }

    if (parent.businessId !== targetBusinessId) {
      throw new CrossBusinessLocationError('Parent location must belong to the exact same business.');
    }

    if (parent.branchId !== targetBranchId) {
      throw new Error('Parent location must belong to the exact same branch.');
    }

    if (!locationId) return; // New location creation cannot form a cycle with ancestors

    // Detect cycles in the ancestor chain
    let currentId: string | null | undefined = parent.parentLocationId;
    const visited = new Set<string>([newParentId]);

    while (currentId) {
      if (currentId === locationId) {
        throw new CircularHierarchyError('Circular hierarchy detected: child location cannot become its own ancestor.');
      }
      if (visited.has(currentId)) {
        throw new CircularHierarchyError('Cycle detected in existing location tree.');
      }
      visited.add(currentId);
      const ancestor = lookupParentFn(currentId);
      currentId = ancestor ? ancestor.parentLocationId : null;
    }
  }

  /**
   * Validates whether a location can be safely archived (soft-deleted).
   */
  public static validateArchival(onHandScaled: number, reservedScaled: number): void {
    if (onHandScaled !== 0) {
      throw new LocationHasStockError(
        `Cannot archive location containing non-zero stock (Current On-Hand: ${onHandScaled}). Transfer or adjust stock first.`
      );
    }
    if (reservedScaled > 0) {
      throw new LocationHasReservedStockError(
        `Cannot archive location containing reserved stock (Reserved: ${reservedScaled}). Clear reservations first.`
      );
    }
  }

  /**
   * Validates that a location can receive stock.
   */
  public static validateReceivable(location: {
    name: string;
    isActive: boolean;
    isReceivable: boolean;
  }): void {
    if (!location.isActive) {
      throw new LocationInactiveError(`Location "${location.name}" is deactivated/inactive.`);
    }
    if (!location.isReceivable) {
      throw new LocationNotReceivableError(`Location "${location.name}" is configured as non-receivable.`);
    }
  }

  /**
   * Validates that a location can fulfil sales.
   */
  public static validateSellable(location: {
    name: string;
    isActive: boolean;
    isSellable: boolean;
    locationType?: string;
  }): void {
    if (!location.isActive) {
      throw new LocationInactiveError(`Location "${location.name}" is deactivated/inactive.`);
    }
    if (
      !location.isSellable ||
      location.locationType === 'damaged' ||
      location.locationType === 'quarantine'
    ) {
      throw new LocationNotSellableError(
        `Location "${location.name}" cannot fulfil sales (location type: ${location.locationType}, sellable: ${location.isSellable}).`
      );
    }
  }

  /**
   * Computes available stock from on-hand and reserved amounts.
   */
  public static calculateAvailableStock(onHandScaled: number, reservedScaled: number): number {
    return Math.max(0, onHandScaled - reservedScaled);
  }

  /**
   * Validates internal stock transfers.
   */
  public static validateInternalTransfer(
    sourceLoc: { id: string; branchId: string; isActive: boolean; name: string },
    destLoc: { id: string; branchId: string; isActive: boolean; isReceivable: boolean; name: string },
    quantityScaled: number
  ): void {
    if (quantityScaled <= 0) {
      throw new Error('Transfer quantity must be strictly greater than zero.');
    }
    if (sourceLoc.id === destLoc.id) {
      throw new Error('Source and destination locations cannot be identical.');
    }
    if (!sourceLoc.isActive) {
      throw new LocationInactiveError(`Source location "${sourceLoc.name}" is inactive.`);
    }
    this.validateReceivable(destLoc);

    if (sourceLoc.branchId !== destLoc.branchId) {
      throw new CrossBranchTransferMismatchError();
    }
  }
}

