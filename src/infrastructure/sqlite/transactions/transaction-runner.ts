import Database from 'better-sqlite3';
import { getDatabase } from '../connection';

export class TransactionRunner {
  /**
   * Executes a callback within a strict SQLite transaction.
   * If any error is thrown, the entire operation is automatically rolled back.
   */
  public static run<T>(callback: (db: Database.Database) => T, customDb?: Database.Database): T {
    const db = customDb || getDatabase();
    const trx = db.transaction(() => {
      return callback(db);
    });
    return trx();
  }
}

