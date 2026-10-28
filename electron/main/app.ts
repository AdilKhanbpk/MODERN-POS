import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc/register-handlers';
import { initDatabase, closeDatabase } from '../../src/infrastructure/sqlite/connection';
import { AutoBackupManager } from './backup/auto-backup';

// Ensure single instance lock so only one POS terminal accesses the local SQLite file
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.warn('[Electron] Another instance of POS is already running. Exiting...');
  app.quit();
} else {
  const autoBackupManager = new AutoBackupManager();

  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      if (allWindows[0].isMinimized()) allWindows[0].restore();
      allWindows[0].focus();
    }
  });

  app.whenReady().then(() => {
    try {
      console.log('[POS Application] Initializing SQLite Database and running migrations...');
      initDatabase();

      console.log('[POS Application] Registering secure IPC handlers...');
      registerIpcHandlers();

      console.log('[POS Application] Spawning Main Window...');
      createMainWindow();
    } catch (err) {
      console.error('[POS Application] Fatal startup failure:', err);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    try {
      console.log('[POS Application] Running auto-backup before quit...');
      autoBackupManager.performAutoBackup();
      console.log('[POS Application] Closing SQLite database connection cleanly...');
      closeDatabase();
    } catch (err) {
      console.error('[POS Application] Error during shutdown:', err);
    }
  });
}

