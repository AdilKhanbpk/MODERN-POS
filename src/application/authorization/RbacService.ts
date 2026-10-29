import Database from 'better-sqlite3';
import { getDatabase } from '../../infrastructure/sqlite/connection';
import { SecurityContext } from '../../shared/types/auth-security';
import { ForbiddenError } from '../../shared/errors/AppError';

export class RbacService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Retrieves all granular permission codes assigned to a user via their roles.
   */
  public getUserPermissions(userId: string, businessId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON ur.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE ur.user_id = ? AND ur.business_id = ?`
      )
      .all(userId, businessId) as Array<{ code: string }>;

    const perms = new Set<string>();
    for (const r of rows) {
      perms.add(r.code);
      // Support dot and colon interchangeability
      if (r.code.includes('.')) {
        perms.add(r.code.replace(/\./g, ':'));
      } else if (r.code.includes(':')) {
        perms.add(r.code.replace(/:/g, '.'));
      }
    }

    return perms;
  }

  /**
   * Checks whether a user's context possesses a specific permission.
   */
  public hasPermission(context: SecurityContext, permissionCode: string): boolean {
    if (!context) return false;

    // Owner role has implicit master authority across all operations
    if (context.roleName === 'Owner' || context.roleName === 'ADMIN') {
      return true;
    }

    const normalized = permissionCode.trim();
    if (context.permissions.has(normalized)) return true;

    // Check dot vs colon format
    const dotVariant = normalized.replace(/:/g, '.');
    const colonVariant = normalized.replace(/\./g, ':');

    return context.permissions.has(dotVariant) || context.permissions.has(colonVariant);
  }

  /**
   * Asserts whether a user has a specific permission. Throws ForbiddenError if missing.
   */
  public assertPermission(
    context: SecurityContext,
    permissionCode: string,
    actionDescription?: string
  ): void {
    if (!this.hasPermission(context, permissionCode)) {
      const msg =
        actionDescription ||
        `Access Forbidden: User "${context.username}" (${context.roleName}) lacks required permission "${permissionCode}".`;
      throw new ForbiddenError(msg, {
        userId: context.userId,
        roleName: context.roleName,
        requiredPermission: permissionCode
      });
    }
  }

  /**
   * Validates that a user has permission to access a specific store branch.
   */
  public assertBranchAccess(context: SecurityContext, targetBranchId: string): void {
    if (context.roleName === 'Owner' || context.roleName === 'Administrator' || context.roleName === 'ADMIN') {
      return; // Enterprise administrators have multi-branch access
    }

    const access = this.db
      .prepare('SELECT 1 FROM user_branch_access WHERE user_id = ? AND branch_id = ?')
      .get(context.userId, targetBranchId);

    if (!access) {
      throw new ForbiddenError(
        `Cross-branch access violation: User "${context.username}" does not have access to branch "${targetBranchId}".`,
        { userId: context.userId, branchId: targetBranchId }
      );
    }
  }

  /**
   * Filters out purchase cost data if the user does not have `inventory.view_cost`.
   */
  public filterSensitiveCost<T extends Record<string, any>>(record: T, context: SecurityContext): T {
    if (this.hasPermission(context, 'inventory.view_cost')) {
      return record;
    }

    const filtered = { ...record };
    delete (filtered as any).cost_price;
    delete (filtered as any).default_cost_minor;
    delete (filtered as any).unit_cost_minor;
    delete (filtered as any).costPrice;
    delete (filtered as any).defaultCostMinor;
    return filtered;
  }

  /**
   * Filters out gross/net profit data if the user does not have `reports.profit`.
   */
  public filterSensitiveProfit<T extends Record<string, any>>(record: T, context: SecurityContext): T {
    if (this.hasPermission(context, 'reports.profit')) {
      return record;
    }

    const filtered = { ...record };
    delete (filtered as any).total_cost_minor;
    delete (filtered as any).profit_minor;
    delete (filtered as any).line_profit_minor;
    delete (filtered as any).gross_profit;
    delete (filtered as any).net_profit;
    delete (filtered as any).totalProfit;
    return filtered;
  }
}

