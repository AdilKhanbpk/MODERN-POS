"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorizationService = void 0;
const roles_permissions_1 = require("../../shared/constants/roles-permissions");
class AuthorizationService {
    /**
     * Checks if a specific role is allowed to perform a given action.
     */
    static hasPermission(role, permission) {
        const allowed = roles_permissions_1.ROLE_PERMISSIONS[role];
        if (!allowed)
            return false;
        return allowed.includes(permission);
    }
    /**
     * Throws an error if the user's role lacks the required permission.
     */
    static enforce(role, permission, actionDescription) {
        if (!this.hasPermission(role, permission)) {
            const msg = actionDescription || `Access Denied: Missing permission '${permission}'`;
            throw new Error(msg);
        }
    }
}
exports.AuthorizationService = AuthorizationService;
