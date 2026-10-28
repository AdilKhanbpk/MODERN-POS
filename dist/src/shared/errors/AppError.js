"use strict";
/**
 * Shared: Application Error Hierarchy
 * Standardized error classes with typed machine-readable codes for uniform error handling
 * across Electron main, preload, and renderer boundaries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyConflictError = exports.BusinessRuleViolationError = exports.InsufficientStockError = exports.NotFoundError = exports.ForbiddenError = exports.UnauthorizedError = exports.ValidationError = exports.AppError = void 0;
class AppError extends Error {
    code;
    statusCode;
    details;
    isOperational;
    constructor(message, code, statusCode = 400, details) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            statusCode: this.statusCode,
            details: this.details
        };
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 400, details);
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 'UNAUTHORIZED', 401);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends AppError {
    constructor(message = 'Access forbidden: Insufficient role permissions') {
        super(message, 'FORBIDDEN', 403);
    }
}
exports.ForbiddenError = ForbiddenError;
class NotFoundError extends AppError {
    constructor(entityName, id) {
        super(id !== undefined ? `${entityName} with id "${id}" was not found.` : `${entityName} not found.`, 'NOT_FOUND', 404);
    }
}
exports.NotFoundError = NotFoundError;
class InsufficientStockError extends AppError {
    constructor(productName, available, requested) {
        super(`Insufficient stock for "${productName}". Requested: ${requested}, Available: ${available}.`, 'INSUFFICIENT_STOCK', 409, { productName, available, requested });
    }
}
exports.InsufficientStockError = InsufficientStockError;
class BusinessRuleViolationError extends AppError {
    constructor(message, details) {
        super(message, 'BUSINESS_RULE_ERROR', 422, details);
    }
}
exports.BusinessRuleViolationError = BusinessRuleViolationError;
class IdempotencyConflictError extends AppError {
    constructor(key) {
        super(`Duplicate request detected for idempotency key "${key}".`, 'IDEMPOTENCY_VIOLATION', 409, { key });
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
