"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabasePath = getDatabasePath;
exports.initDatabase = initDatabase;
exports.getDatabase = getDatabase;
exports.setDatabase = setDatabase;
exports.closeDatabase = closeDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const migration_runner_1 = require("./migrations/migration-runner");
let dbInstance = null;
function getDatabasePath() {
    // If in Electron, store in appData or workspace pos-data directory
    const baseDir = process.env.POS_DATA_DIR || path_1.default.resolve(process.cwd(), 'data');
    if (!fs_1.default.existsSync(baseDir)) {
        fs_1.default.mkdirSync(baseDir, { recursive: true });
    }
    return path_1.default.join(baseDir, 'pos-database.sqlite');
}
function initDatabase(dbPath) {
    if (dbInstance) {
        return dbInstance;
    }
    const resolvedPath = dbPath || getDatabasePath();
    const db = new better_sqlite3_1.default(resolvedPath);
    // Performance and integrity pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    // Run migrations
    (0, migration_runner_1.runMigrations)(db);
    dbInstance = db;
    return dbInstance;
}
function getDatabase() {
    if (!dbInstance) {
        return initDatabase();
    }
    return dbInstance;
}
function setDatabase(db) {
    dbInstance = db;
}
function closeDatabase() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
