import { Role, Permission, ROLE_PERMISSIONS } from '../../shared/constants/roles-permissions';

export class AuthorizationService {
  /**
   * Checks if a specific role is allowed to perform a given action.
   */
  public static hasPermission(role: Role, permission: Permission): boolean {
    const allowed = ROLE_PERMISSIONS[role];
    if (!allowed) return false;
    return allowed.includes(permission);
  }

  /**
   * Throws an error if the user's role lacks the required permission.
   */
  public static enforce(role: Role, permission: Permission, actionDescription?: string): void {
    if (!this.hasPermission(role, permission)) {
      const msg = actionDescription || `Access Denied: Missing permission '${permission}'`;
      throw new Error(msg);
    }
  }
}

