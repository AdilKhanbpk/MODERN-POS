import Database from 'better-sqlite3';
import { getDatabase } from '../connection';
import { IdempotencyKey } from '../../../shared/types';

export class IdempotencyRepository {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Checks if an idempotency key was already processed.
   * If exists, returns the cached result to prevent double-posting.
   */
  public findKey(key: string): IdempotencyKey | null {
    const row = this.db.prepare(`
      SELECT key, operation_type as operationType, response_payload as responsePayload, created_at as createdAt
      FROM idempotency_keys
      WHERE key = ?
    `).get(key) as IdempotencyKey | undefined;

    return row || null;
  }

  /**
   * Saves the operation key and its payload response.
   */
  public saveKey(key: string, operationType: string, responsePayload: any): void {
    const payloadStr = typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload);
    this.db.prepare(`
      INSERT INTO idempotency_keys (key, operation_type, response_payload)
      VALUES (?, ?, ?)
    `).run(key, operationType, payloadStr);
  }
}

