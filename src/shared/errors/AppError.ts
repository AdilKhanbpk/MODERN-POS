/**
 * Shared: Application Error Hierarchy
 * Standardized error classes with typed machine-readable codes for uniform error handling
 * across Electron main, preload, and renderer boundaries.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_VIOLATION'
  | 'MONEY_PRECISION_ERROR'
  | 'QUANTITY_SCALE_ERROR'
  | 'DATABASE_ERROR'
  | 'HARDWARE_ERROR'
  | 'CIRCULAR_DEPENDENCY'
  | 'MODULE_DISABLED'
  | 'BUSINESS_RULE_ERROR';

export interface SerializedAppError {
  name: string;
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: any;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: any;
  public readonly isOperational: boolean;

  constructor(message: string, code: ErrorCode, statusCode = 400, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON(): SerializedAppError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details?: any) {
    super(message, 'UNAUTHORIZED', 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden: Insufficient role permissions', details?: any) {
    super(message, 'FORBIDDEN', 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(entityName: string, id?: string | number) {
    super(
      id !== undefined ? `${entityName} with id "${id}" was not found.` : `${entityName} not found.`,
      'NOT_FOUND',
      404
    );
  }
}

export class InsufficientStockError extends AppError {
  constructor(productName: string, available: number, requested: number) {
    super(
      `Insufficient stock for "${productName}". Requested: ${requested}, Available: ${available}.`,
      'INSUFFICIENT_STOCK',
      409,
      { productName, available, requested }
    );
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'BUSINESS_RULE_ERROR', 422, details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(key: string) {
    super(`Duplicate request detected for idempotency key "${key}".`, 'IDEMPOTENCY_VIOLATION', 409, { key });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'DATABASE_ERROR', 409, details);
  }
}

