/**
 * Shared: Universal Multi-Tenant Enterprise Core Types
 * Supporting multiple businesses, branches, counters, users, roles, permissions,
 * modular feature definitions, and immutable audit logs.
 */

export interface Business {
  id: string; // UUID
  name: string;
  legalName?: string;
  businessType: string;
  registrationNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  defaultCurrency: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string; // UUID
  businessId: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Counter {
  id: string; // UUID
  businessId: string;
  branchId: string;
  name: string;
  code: string;
  deviceIdentifier?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseUser {
  id: string; // UUID
  businessId: string;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseRole {
  id: string; // UUID
  businessId: string;
  name: string;
  description?: string;
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnterprisePermission {
  id: string; // UUID
  code: string;
  module: string;
  description: string;
}

export interface RolePermissionAssignment {
  roleId: string;
  permissionId: string;
}

export interface UserRoleAssignment {
  userId: string;
  roleId: string;
  businessId: string;
}

export interface UserBranchAccess {
  userId: string;
  branchId: string;
}

export interface EnterpriseBusinessSetting {
  id: string; // UUID
  businessId: string;
  settingKey: string;
  settingValue: Record<string, any> | string | number | boolean;
  updatedBy?: string;
  updatedAt: string;
}

export interface ModuleDefinition {
  id: string; // UUID
  moduleCode: string;
  moduleName: string;
  description?: string;
  isCore: boolean;
  dependencies?: string[];
  createdAt: string;
}

export interface BusinessModule {
  id: string; // UUID
  businessId: string;
  moduleId: string;
  isEnabled: boolean;
  configuration?: Record<string, any>;
  enabledAt?: string;
  disabledAt?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface EnterpriseAuditLog {
  id: string; // UUID
  businessId: string;
  branchId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: Record<string, any>;
  afterData?: Record<string, any>;
  reason?: string;
  ipAddress?: string;
  deviceIdentifier?: string;
  createdAt: string;
}

