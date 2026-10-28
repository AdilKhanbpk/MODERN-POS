import { BackupService } from '../../../src/application/services/BackupService';
import { SettingsService } from '../../../src/application/services/SettingsService';

export class AutoBackupManager {
  private backupService = new BackupService();
  private settingsService = new SettingsService();

  public performAutoBackup(): void {
    try {
      const settings = this.settingsService.getSettings();
      if (settings.autoBackupOnClose) {
        console.log('[AutoBackup] Running automated shutdown backup...');
        const result = this.backupService.createBackup(settings.backupPath);
        console.log(`[AutoBackup] Completed successfully at ${result.filePath} (${result.sizeBytes} bytes)`);
      }
    } catch (err) {
      console.error('[AutoBackup] Error during automated backup:', err);
    }
  }
}

