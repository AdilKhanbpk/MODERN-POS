"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackupService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const connection_1 = require("../../infrastructure/sqlite/connection");
class BackupService {
    createBackup(destinationDir) {
        const db = (0, connection_1.getDatabase)();
        const backupFolder = destinationDir || path_1.default.resolve(process.cwd(), 'backups');
        if (!fs_1.default.existsSync(backupFolder)) {
            fs_1.default.mkdirSync(backupFolder, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `pos-backup-${timestamp}.sqlite`;
        const targetPath = path_1.default.join(backupFolder, backupFileName);
        // SQLite safe online backup via VACUUM INTO
        // Escape single quotes for SQL string literal
        const escapedPath = targetPath.replace(/'/g, "''");
        db.prepare(`VACUUM INTO '${escapedPath}'`).run();
        const stats = fs_1.default.statSync(targetPath);
        return {
            success: true,
            filePath: targetPath,
            sizeBytes: stats.size
        };
    }
    listBackups(backupDir) {
        const backupFolder = backupDir || path_1.default.resolve(process.cwd(), 'backups');
        if (!fs_1.default.existsSync(backupFolder)) {
            return [];
        }
        const files = fs_1.default.readdirSync(backupFolder).filter(f => f.endsWith('.sqlite'));
        return files.map(file => {
            const fullPath = path_1.default.join(backupFolder, file);
            const stats = fs_1.default.statSync(fullPath);
            return {
                fileName: file,
                filePath: fullPath,
                sizeBytes: stats.size,
                createdAt: stats.birthtime.toISOString()
            };
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    restoreBackup(backupFilePath) {
        if (!fs_1.default.existsSync(backupFilePath)) {
            throw new Error('Backup file does not exist');
        }
        const mainDbPath = (0, connection_1.getDatabasePath)();
        // Close active database
        (0, connection_1.closeDatabase)();
        // Copy backup over current db
        fs_1.default.copyFileSync(backupFilePath, mainDbPath);
        // Reopen database
        (0, connection_1.initDatabase)(mainDbPath);
        return true;
    }
}
exports.BackupService = BackupService;
