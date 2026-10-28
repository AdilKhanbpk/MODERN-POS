"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyRepository = void 0;
const connection_1 = require("../connection");
class IdempotencyRepository {
    db;
    constructor(db = (0, connection_1.getDatabase)()) {
        this.db = db;
    }
    /**
     * Checks if an idempotency key was already processed.
     * If exists, returns the cached result to prevent double-posting.
     */
    findKey(key) {
        const row = this.db.prepare(`
      SELECT key, operation_type as operationType, response_payload as responsePayload, created_at as createdAt
      FROM idempotency_keys
      WHERE key = ?
    `).get(key);
        return row || null;
    }
    /**
     * Saves the operation key and its payload response.
     */
    saveKey(key, operationType, responsePayload) {
        const payloadStr = typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload);
        this.db.prepare(`
      INSERT INTO idempotency_keys (key, operation_type, response_payload)
      VALUES (?, ?, ?)
    `).run(key, operationType, payloadStr);
    }
}
exports.IdempotencyRepository = IdempotencyRepository;
