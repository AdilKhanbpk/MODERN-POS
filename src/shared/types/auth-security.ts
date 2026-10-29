/**
 * Shared: Authentication, Sessions, Granular Permissions, and Approval Workflows
 */

export type ApprovalRequestType =
  | 'DISCOUNT_OVERRIDE'
  | 'SELLING_BELOW_MARGIN'
  | 'NEGATIVE_STOCK'
  | 'LARGE_STOCK_ADJUSTMENT'
  | 'PAYMENT_REVERSAL'
  | 'SALE_VOID_AFTER_POST'
  | 'PRICE_OVERRIDE'
  | 'CREDIT_LIMIT_OVERRIDE';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface UserSession {
  id: string; // UUID
  businessId: string;
  userId: string;
  sessionTokenHash: string;
  deviceIdentifier?: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface ApprovalRequest {
  id: string; // UUID
  businessId: string;
  branchId: string;
  requestType: ApprovalRequestType;
  entityType: string;
  entityId?: string | null;
  requestedBy: string;
  approvedBy?: string | null;
  requestData?: Record<string, any>;
  originalValue?: string;
  proposedValue?: string;
  reason?: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string | null;
  // Joined details for UI/audit
  requestingUserName?: string;
  approvingUserName?: string;
}

export interface SecurityContext {
  userId: string;
  businessId: string;
  branchId?: string;
  username: string;
  fullName: string;
  roleName: string;
  permissions: Set<string>;
  sessionToken?: string;
  deviceIdentifier?: string;
}

export interface LoginResult {
  sessionToken: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    roleName: string;
    businessId: string;
    branchId?: string;
  };
  permissions: string[];
  expiresAt: string;
}

export interface AuthLockoutPolicy {
  maxFailedAttempts: number; // default 5
  lockoutDurationMinutes: number; // default 15
}

export interface ApprovalPolicyConfig {
  maxDiscountPercentWithoutApproval: number; // e.g. 10%
  allowSelfApproval: boolean; // default false
  requireNegativeStockApproval: boolean; // default true
  maxAdjustmentValueWithoutApprovalMinor: number; // e.g. 500,000 paisa (Rs 5,000)
}

