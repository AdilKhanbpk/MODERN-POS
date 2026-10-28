import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrations/migration-runner';

let dbInstance: Database.Database | null = null;

export function getDatabasePath(): string {
  // If in Electron, store in appData or workspace pos-data directory
  const baseDir = process.env.POS_DATA_DIR || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return path.join(baseDir, 'pos-database.sqlite');
}

export function initDatabase(dbPath?: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath = dbPath || getDatabasePath();
  const db = new Database(resolvedPath);

  // Performance and integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  // Run migrations
  runMigrations(db);

  dbInstance = db;
  return dbInstance;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

