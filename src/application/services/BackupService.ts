import fs from 'fs';
import path from 'path';
import { getDatabase, getDatabasePath, closeDatabase, initDatabase } from '../../infrastructure/sqlite/connection';

export class BackupService {
  public createBackup(destinationDir?: string): { success: boolean; filePath: string; sizeBytes: number } {
    const db = getDatabase();
    const backupFolder = destinationDir || path.resolve(process.cwd(), 'backups');

    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `pos-backup-${timestamp}.sqlite`;
    const targetPath = path.join(backupFolder, backupFileName);

    // SQLite safe online backup via VACUUM INTO
    // Escape single quotes for SQL string literal
    const escapedPath = targetPath.replace(/'/g, "''");
    db.prepare(`VACUUM INTO '${escapedPath}'`).run();

    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      sizeBytes: stats.size
    };
  }

  public listBackups(backupDir?: string): Array<{ fileName: string; filePath: string; sizeBytes: number; createdAt: string }> {
    const backupFolder = backupDir || path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupFolder)) {
      return [];
    }

    const files = fs.readdirSync(backupFolder).filter(f => f.endsWith('.sqlite'));
    return files.map(file => {
      const fullPath = path.join(backupFolder, file);
      const stats = fs.statSync(fullPath);
      return {
        fileName: file,
        filePath: fullPath,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString()
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public restoreBackup(backupFilePath: string): boolean {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error('Backup file does not exist');
    }

    const mainDbPath = getDatabasePath();

    // Close active database
    closeDatabase();

    // Copy backup over current db
    fs.copyFileSync(backupFilePath, mainDbPath);

    // Reopen database
    initDatabase(mainDbPath);

    return true;
  }
}

