import Database from 'better-sqlite3';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../../infrastructure/sqlite/connection';
import { RbacService } from '../authorization/RbacService';
import {
  SecurityContext,
  LoginResult,
  AuthLockoutPolicy
} from '../../shared/types/auth-security';
import { User } from '../../shared/types';
import { Role } from '../../shared/constants/roles-permissions';
import { UnauthorizedError, ValidationError, ForbiddenError } from '../../shared/errors/AppError';

export class AuthService {
  private rbac: RbacService;
  private currentUser: User | null = null; // Memory cache for desktop session state

  constructor(private db: Database.Database = getDatabase()) {
    this.rbac = new RbacService(this.db);
  }

  /**
   * Retrieves account lockout policy from business settings, or falls back to standard defaults.
   */
  public getLockoutPolicy(businessId?: string): AuthLockoutPolicy {
    if (businessId) {
      const row = this.db
        .prepare("SELECT setting_value FROM business_settings WHERE business_id = ? AND setting_key = 'lockout_policy'")
        .get(businessId) as { setting_value: string } | undefined;

      if (row?.setting_value) {
        try {
          return JSON.parse(row.setting_value) as AuthLockoutPolicy;
        } catch {
          // fall through
        }
      }
    }

    return {
      maxFailedAttempts: 5,
      lockoutDurationMinutes: 15
    };
  }

  /**
   * Secure login with Argon2id/bcrypt verification, attempt throttling, and account lockout.
   */
  public login(params: {
    username: string;
    passwordPlain: string;
    deviceIdentifier?: string;
  }): LoginResult {
    const { username, passwordPlain, deviceIdentifier } = params;

    const user = this.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username.trim()) as any;

    if (!user) {
      throw new UnauthorizedError('Invalid username or password.');
    }

    // 1. Check account lockout
    if (user.locked_until) {
      const lockedUntilDate = new Date(user.locked_until);
      const now = new Date();
      if (lockedUntilDate > now) {
        const remainingMinutes = Math.ceil((lockedUntilDate.getTime() - now.getTime()) / 60000);
        throw new UnauthorizedError(
          `Account is temporarily locked due to multiple failed login attempts. Please try again after ${remainingMinutes} minute(s).`
        );
      } else {
        // Lockout expired, reset counter
        this.db.prepare('UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = ?').run(user.id);
        user.locked_until = null;
        user.failed_login_attempts = 0;
      }
    }

    // 2. Check active status
    if (user.is_active !== 1) {
      throw new UnauthorizedError('This account has been deactivated. Please contact your store administrator.');
    }

    // 3. Verify password hash
    const isMatch = bcrypt.compareSync(passwordPlain, user.password_hash);
    if (!isMatch) {
      const policy = this.getLockoutPolicy(user.business_id);
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;

      let lockedUntil: string | null = null;
      if (newFailedAttempts >= policy.maxFailedAttempts) {
        lockedUntil = new Date(Date.now() + policy.lockoutDurationMinutes * 60000).toISOString();
      }

      this.db
        .prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
        .run(newFailedAttempts, lockedUntil, user.id);

      // Audit log failed login
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          user.business_id,
          user.id,
          lockedUntil ? 'USER_ACCOUNT_LOCKED' : 'USER_LOGIN_FAILED',
          'user',
          user.id,
          lockedUntil
            ? `Account locked after ${newFailedAttempts} consecutive failed password attempts`
            : `Failed password attempt (${newFailedAttempts}/${policy.maxFailedAttempts})`
        );

      if (lockedUntil) {
        throw new UnauthorizedError(
          `Account locked due to ${policy.maxFailedAttempts} consecutive failed login attempts. Try again in ${policy.lockoutDurationMinutes} minutes.`
        );
      }

      throw new UnauthorizedError('Invalid username or password.');
    }

    // 4. Successful login: reset failed attempts & update last login
    this.db
      .prepare(
        `UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL,
             last_login_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE id = ?`
      )
      .run(user.id);

    // 5. Generate secure session token (never store plaintext in DB)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); // 8 hour shift

    this.db
      .prepare(
        `INSERT INTO user_sessions (id, business_id, user_id, session_token_hash, device_identifier, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, user.business_id, user.id, sessionTokenHash, deviceIdentifier || 'DESKTOP-POS', expiresAt);

    // 6. Fetch primary role & permissions
    const userRoleRow = this.db
      .prepare(
        `SELECT r.name as role_name
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND ur.business_id = ?
         LIMIT 1`
      )
      .get(user.id, user.business_id) as { role_name: string } | undefined;

    const roleName = userRoleRow?.role_name || user.role || 'CASHIER';
    const permissions = Array.from(this.rbac.getUserPermissions(user.id, user.business_id));

    // Fetch primary branch
    const branchAccess = this.db
      .prepare('SELECT branch_id FROM user_branch_access WHERE user_id = ? LIMIT 1')
      .get(user.id) as { branch_id: string } | undefined;

    // Audit log successful login
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        user.business_id,
        user.id,
        'USER_LOGIN_SUCCESS',
        'user',
        user.id,
        `User "${user.username}" authenticated successfully on ${deviceIdentifier || 'DESKTOP-POS'}`
      );

    // Cache user for desktop session
    this.currentUser = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: roleName as any,
      isActive: user.is_active === 1,
      createdAt: user.created_at
    };

    return {
      sessionToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        roleName,
        businessId: user.business_id,
        branchId: branchAccess?.branch_id
      },
      permissions,
      expiresAt
    };
  }

  /**
   * Verifies an active session token and builds a validated SecurityContext.
   */
  public verifySession(sessionToken: string): SecurityContext {
    if (!sessionToken || sessionToken.trim().length === 0) {
      throw new UnauthorizedError('Authentication session token is required.');
    }

    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    const session = this.db
      .prepare(
        `SELECT s.id, s.business_id, s.user_id, s.device_identifier, s.expires_at, s.revoked_at,
                u.username, u.full_name, u.is_active
         FROM user_sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.session_token_hash = ?`
      )
      .get(sessionTokenHash) as any;

    if (!session) {
      throw new UnauthorizedError('Session not found or invalid.');
    }

    if (session.revoked_at) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    if (new Date(session.expires_at) <= new Date()) {
      throw new UnauthorizedError('Session expired. Please log in again.');
    }

    if (session.is_active !== 1) {
      throw new UnauthorizedError('User account has been deactivated.');
    }

    const userRoleRow = this.db
      .prepare(
        `SELECT r.name as role_name
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND ur.business_id = ?
         LIMIT 1`
      )
      .get(session.user_id, session.business_id) as { role_name: string } | undefined;

    const roleName = userRoleRow?.role_name || 'CASHIER';
    const permissions = this.rbac.getUserPermissions(session.user_id, session.business_id);

    const branchAccess = this.db
      .prepare('SELECT branch_id FROM user_branch_access WHERE user_id = ? LIMIT 1')
      .get(session.user_id) as { branch_id: string } | undefined;

    return {
      userId: session.user_id,
      businessId: session.business_id,
      branchId: branchAccess?.branch_id,
      username: session.username,
      fullName: session.full_name,
      roleName,
      permissions,
      sessionToken,
      deviceIdentifier: session.device_identifier
    };
  }

  /**
   * Revokes the current session upon logout.
   */
  public logout(sessionToken?: string): void {
    if (sessionToken) {
      const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      this.db
        .prepare(
          `UPDATE user_sessions
           SET revoked_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
           WHERE session_token_hash = ? AND revoked_at IS NULL`
        )
        .run(sessionTokenHash);
    }
    this.currentUser = null;
  }

  /**
   * Revokes all active sessions for a target user.
   */
  public revokeAllUserSessions(userId: string, context?: SecurityContext): void {
    if (context && context.userId !== userId) {
      this.rbac.assertPermission(context, 'users.manage', 'Revoke user sessions');
    }

    this.db
      .prepare(
        `UPDATE user_sessions
         SET revoked_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE user_id = ? AND revoked_at IS NULL`
      )
      .run(userId);
  }

  /**
   * User password change (requires verification of current password).
   */
  public changePassword(
    userId: string,
    currentPasswordPlain: string,
    newPasswordPlain: string
  ): void {
    if (!newPasswordPlain || newPasswordPlain.length < 6) {
      throw new ValidationError('New password must be at least 6 characters long.');
    }

    const user = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    const isMatch = bcrypt.compareSync(currentPasswordPlain, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Current password is incorrect.');
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPasswordPlain, salt);

    this.db
      .prepare(
        `UPDATE users
         SET password_hash = ?,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE id = ?`
      )
      .run(newHash, userId);

    // Revoke previous sessions on password change
    this.revokeAllUserSessions(userId);
  }

  /**
   * Admin password reset for another user (requires users.manage permission).
   */
  public adminResetPassword(
    targetUserId: string,
    newPasswordPlain: string,
    adminContext: SecurityContext
  ): void {
    this.rbac.assertPermission(adminContext, 'users.manage', 'Reset employee password');

    if (!newPasswordPlain || newPasswordPlain.length < 6) {
      throw new ValidationError('New password must be at least 6 characters long.');
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPasswordPlain, salt);

    this.db
      .prepare(
        `UPDATE users
         SET password_hash = ?,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
         WHERE id = ?`
      )
      .run(newHash, targetUserId);

    this.revokeAllUserSessions(targetUserId);

    this.db
      .prepare(
        `INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        adminContext.businessId,
        adminContext.userId,
        'ADMIN_PASSWORD_RESET',
        'user',
        targetUserId,
        `Admin "${adminContext.username}" reset password for user ID "${targetUserId}"`
      );
  }

  // --- Legacy Compatibility Methods ---
  public getCurrentUser(): User | null {
    return this.currentUser;
  }

  public listUsers(): User[] {
    const rows = this.db.prepare('SELECT id, username, full_name, is_active, created_at FROM users').all() as any[];
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      fullName: r.full_name,
      role: Role.CASHIER,
      isActive: r.is_active === 1,
      createdAt: r.created_at
    }));
  }

  public createUser(userData: {
    username: string;
    passwordPlain: string;
    fullName: string;
    role: Role;
  }): number {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(userData.passwordPlain, salt);

    // Get active business
    const bizRow = this.db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'active_business_id'").get() as any;
    const businessId = bizRow?.setting_value || '00000000-0000-0000-0000-000000000001';

    const userId = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, business_id, username, password_hash, full_name, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run(userId, businessId, userData.username, passwordHash, userData.fullName);

    // Map role
    const roleRow = this.db.prepare('SELECT id FROM roles WHERE business_id = ? AND name = ?').get(businessId, userData.role) as any;
    if (roleRow) {
      this.db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, business_id) VALUES (?, ?, ?)').run(userId, roleRow.id, businessId);
    }

    return 1;
  }

  public updatePassword(userId: number, newPasswordPlain: string): void {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPasswordPlain, salt);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, String(userId));
  }
}
