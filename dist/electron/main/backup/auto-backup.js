"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoBackupManager = void 0;
const BackupService_1 = require("../../../src/application/services/BackupService");
const SettingsService_1 = require("../../../src/application/services/SettingsService");
class AutoBackupManager {
    backupService = new BackupService_1.BackupService();
    settingsService = new SettingsService_1.SettingsService();
    performAutoBackup() {
        try {
            const settings = this.settingsService.getSettings();
            if (settings.autoBackupOnClose) {
                console.log('[AutoBackup] Running automated shutdown backup...');
                const result = this.backupService.createBackup(settings.backupPath);
                console.log(`[AutoBackup] Completed successfully at ${result.filePath} (${result.sizeBytes} bytes)`);
            }
        }
        catch (err) {
            console.error('[AutoBackup] Error during automated backup:', err);
        }
    }
}
exports.AutoBackupManager = AutoBackupManager;
