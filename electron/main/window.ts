import { BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const isDev = process.env.NODE_ENV === 'development' || !process.defaultApp;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Modern Retail POS - 100% Offline',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0f172a'
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // In production or built distribution
    const rendererPath = path.join(__dirname, '../../renderer/index.html');
    mainWindow.loadFile(rendererPath);
  }

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

