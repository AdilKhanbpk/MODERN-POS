import { ValidationError } from '../../shared/errors/AppError';

export interface CategoryLookupNode {
  id: string;
  parentId?: string | null;
  name: string;
}

/**
 * Validates that setting `newParentId` for `categoryId` does not create a circular dependency
 * or make a category its own ancestor.
 */
export function assertNoCategoryCycle(
  categoryId: string,
  newParentId: string | null | undefined,
  getParentId: (id: string) => string | null | undefined
): void {
  if (!newParentId) {
    return; // Setting to root has no cycle risk
  }

  if (categoryId === newParentId) {
    throw new ValidationError(
      `Circular category hierarchy: Category "${categoryId}" cannot be its own parent.`
    );
  }

  const visited = new Set<string>([categoryId]);
  let currentParentId: string | null | undefined = newParentId;

  while (currentParentId) {
    if (visited.has(currentParentId)) {
      throw new ValidationError(
        `Circular category hierarchy detected: Category "${categoryId}" cannot become an ancestor of itself via parent "${newParentId}".`
      );
    }
    visited.add(currentParentId);
    currentParentId = getParentId(currentParentId);
  }
}

