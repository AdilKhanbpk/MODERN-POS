"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacService = void 0;
const connection_1 = require("../../infrastructure/sqlite/connection");
const AppError_1 = require("../../shared/errors/AppError");
class RbacService {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Retrieves all granular permission codes assigned to a user via their roles.
     */
    getUserPermissions(userId, businessId) {
        const rows = this.db
            .prepare(`SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON ur.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE ur.user_id = ? AND ur.business_id = ?`)
            .all(userId, businessId);
        const perms = new Set();
        for (const r of rows) {
            perms.add(r.code);
            // Support dot and colon interchangeability
            if (r.code.includes('.')) {
                perms.add(r.code.replace(/\./g, ':'));
            }
            else if (r.code.includes(':')) {
                perms.add(r.code.replace(/:/g, '.'));
            }
        }
        return perms;
    }
    /**
     * Checks whether a user's context possesses a specific permission.
     */
    hasPermission(context, permissionCode) {
        if (!context)
            return false;
        // Owner role has implicit master authority across all operations
        if (context.roleName === 'Owner' || context.roleName === 'ADMIN') {
            return true;
        }
        const normalized = permissionCode.trim();
        if (context.permissions.has(normalized))
            return true;
        // Check dot vs colon format
        const dotVariant = normalized.replace(/:/g, '.');
        const colonVariant = normalized.replace(/\./g, ':');
        return context.permissions.has(dotVariant) || context.permissions.has(colonVariant);
    }
    /**
     * Asserts whether a user has a specific permission. Throws ForbiddenError if missing.
     */
    assertPermission(context, permissionCode, actionDescription) {
        if (!this.hasPermission(context, permissionCode)) {
            const msg = actionDescription ||
                `Access Forbidden: User "${context.username}" (${context.roleName}) lacks required permission "${permissionCode}".`;
            throw new AppError_1.ForbiddenError(msg, {
                userId: context.userId,
                roleName: context.roleName,
                requiredPermission: permissionCode
            });
        }
    }
    /**
     * Validates that a user has permission to access a specific store branch.
     */
    assertBranchAccess(context, targetBranchId) {
        if (context.roleName === 'Owner' || context.roleName === 'Administrator' || context.roleName === 'ADMIN') {
            return; // Enterprise administrators have multi-branch access
        }
        const access = this.db
            .prepare('SELECT 1 FROM user_branch_access WHERE user_id = ? AND branch_id = ?')
            .get(context.userId, targetBranchId);
        if (!access) {
            throw new AppError_1.ForbiddenError(`Cross-branch access violation: User "${context.username}" does not have access to branch "${targetBranchId}".`, { userId: context.userId, branchId: targetBranchId });
        }
    }
    /**
     * Filters out purchase cost data if the user does not have `inventory.view_cost`.
     */
    filterSensitiveCost(record, context) {
        if (this.hasPermission(context, 'inventory.view_cost')) {
            return record;
        }
        const filtered = { ...record };
        delete filtered.cost_price;
        delete filtered.default_cost_minor;
        delete filtered.unit_cost_minor;
        delete filtered.costPrice;
        delete filtered.defaultCostMinor;
        return filtered;
    }
    /**
     * Filters out gross/net profit data if the user does not have `reports.profit`.
     */
    filterSensitiveProfit(record, context) {
        if (this.hasPermission(context, 'reports.profit')) {
            return record;
        }
        const filtered = { ...record };
        delete filtered.total_cost_minor;
        delete filtered.profit_minor;
        delete filtered.line_profit_minor;
        delete filtered.gross_profit;
        delete filtered.net_profit;
        delete filtered.totalProfit;
        return filtered;
    }
}
exports.RbacService = RbacService;
