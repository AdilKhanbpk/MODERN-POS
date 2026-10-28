import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { User } from '../../../shared/types';
import { Role } from '../../../shared/constants/roles-permissions';
import { IUserRepository } from '../../../shared/interfaces/repositories/IUserRepository';

export class UserRepository implements IUserRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  public findByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.db.prepare(`
      SELECT id, username, password_hash as passwordHash, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      WHERE username = ? AND is_active = 1
    `).get(username) as any;

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive)
    };
  }

  public findById(id: number): User | null {
    const row = this.db.prepare(`
      SELECT id, username, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive)
    };
  }

  public list(): User[] {
    const rows = this.db.prepare(`
      SELECT id, username, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      ORDER BY id ASC
    `).all() as any[];

    return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
  }

  public create(user: { username: string; passwordHash: string; fullName: string; role: Role }): number {
    const info = this.db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(user.username, user.passwordHash, user.fullName, user.role);

    return Number(info.lastInsertRowid);
  }

  public updatePassword(id: number, newPasswordHash: string): void {
    this.db.prepare(`
      UPDATE users SET password_hash = ? WHERE id = ?
    `).run(newPasswordHash, id);
  }

  public updateStatus(id: number, isActive: boolean): void {
    this.db.prepare(`
      UPDATE users SET is_active = ? WHERE id = ?
    `).run(isActive ? 1 : 0, id);
  }
}

