"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const connection_1 = require("../connection");
class UserRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    findByUsername(username) {
        const row = this.db.prepare(`
      SELECT id, username, password_hash as passwordHash, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      WHERE username = ? AND is_active = 1
    `).get(username);
        if (!row)
            return null;
        return {
            ...row,
            isActive: Boolean(row.isActive)
        };
    }
    findById(id) {
        const row = this.db.prepare(`
      SELECT id, username, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return {
            ...row,
            isActive: Boolean(row.isActive)
        };
    }
    list() {
        const rows = this.db.prepare(`
      SELECT id, username, full_name as fullName, role, is_active as isActive, created_at as createdAt
      FROM users
      ORDER BY id ASC
    `).all();
        return rows.map(r => ({ ...r, isActive: Boolean(r.isActive) }));
    }
    create(user) {
        const info = this.db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(user.username, user.passwordHash, user.fullName, user.role);
        return Number(info.lastInsertRowid);
    }
    updatePassword(id, newPasswordHash) {
        this.db.prepare(`
      UPDATE users SET password_hash = ? WHERE id = ?
    `).run(newPasswordHash, id);
    }
}
exports.UserRepository = UserRepository;
