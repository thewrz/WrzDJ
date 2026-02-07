import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpcHandlers, getBridgeRunner } from './ipc-handlers.js';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 700,
    minHeight: 500,
    title: 'WrzDJ Bridge',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, `../preload/preload.js`),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Register IPC handlers with this window
  registerIpcHandlers(mainWindow);

  // Load the renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Stop bridge on quit
  const runner = getBridgeRunner();
  if (runner.isRunning) {
    await runner.stop();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
