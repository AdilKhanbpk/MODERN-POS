"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
exports.getMainWindow = getMainWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let mainWindow = null;
function createMainWindow() {
    const isDev = process.env.NODE_ENV === 'development' || !process.defaultApp;
    // Enforce strict Content Security Policy (CSP) across all web requests
    electron_1.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
                ]
            }
        });
    });
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        title: 'Modern Retail POS - 100% Offline',
        webPreferences: {
            preload: path_1.default.join(__dirname, '../../preload/index.js'),
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
    }
    else {
        // In production or built distribution
        const rendererPath = path_1.default.join(__dirname, '../../renderer/index.html');
        mainWindow.loadFile(rendererPath);
    }
    return mainWindow;
}
function getMainWindow() {
    return mainWindow;
}
