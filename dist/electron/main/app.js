"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const window_1 = require("./window");
const register_handlers_1 = require("./ipc/register-handlers");
const connection_1 = require("../../src/infrastructure/sqlite/connection");
const auto_backup_1 = require("./backup/auto-backup");
// Ensure single instance lock so only one POS terminal accesses the local SQLite file
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.warn('[Electron] Another instance of POS is already running. Exiting...');
    electron_1.app.quit();
}
else {
    const autoBackupManager = new auto_backup_1.AutoBackupManager();
    electron_1.app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window instead
        const allWindows = electron_1.BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
            if (allWindows[0].isMinimized())
                allWindows[0].restore();
            allWindows[0].focus();
        }
    });
    electron_1.app.whenReady().then(() => {
        try {
            console.log('[POS Application] Initializing SQLite Database and running migrations...');
            (0, connection_1.initDatabase)();
            console.log('[POS Application] Registering secure IPC handlers...');
            (0, register_handlers_1.registerIpcHandlers)();
            console.log('[POS Application] Spawning Main Window...');
            (0, window_1.createMainWindow)();
        }
        catch (err) {
            console.error('[POS Application] Fatal startup failure:', err);
            electron_1.app.quit();
        }
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                (0, window_1.createMainWindow)();
            }
        });
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
    electron_1.app.on('before-quit', () => {
        try {
            console.log('[POS Application] Running auto-backup before quit...');
            autoBackupManager.performAutoBackup();
            console.log('[POS Application] Closing SQLite database connection cleanly...');
            (0, connection_1.closeDatabase)();
        }
        catch (err) {
            console.error('[POS Application] Error during shutdown:', err);
        }
    });
}
