"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNoCategoryCycle = assertNoCategoryCycle;
const AppError_1 = require("../../shared/errors/AppError");
/**
 * Validates that setting `newParentId` for `categoryId` does not create a circular dependency
 * or make a category its own ancestor.
 */
function assertNoCategoryCycle(categoryId, newParentId, getParentId) {
    if (!newParentId) {
        return; // Setting to root has no cycle risk
    }
    if (categoryId === newParentId) {
        throw new AppError_1.ValidationError(`Circular category hierarchy: Category "${categoryId}" cannot be its own parent.`);
    }
    const visited = new Set([categoryId]);
    let currentParentId = newParentId;
    while (currentParentId) {
        if (visited.has(currentParentId)) {
            throw new AppError_1.ValidationError(`Circular category hierarchy detected: Category "${categoryId}" cannot become an ancestor of itself via parent "${newParentId}".`);
        }
        visited.add(currentParentId);
        currentParentId = getParentId(currentParentId);
    }
}
