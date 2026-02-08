import { ipcMain, type BrowserWindow } from 'electron';
import { login, verifyToken, buildAuthState } from './auth-service.js';
import { fetchBridgeApiKey } from './bridge-api-key-service.js';
import { fetchEvents } from './events-service.js';
import { BridgeRunner } from './bridge-runner.js';
import * as store from './store.js';
import { IPC_CHANNELS } from '../shared/types.js';
import type { BridgeSettings } from '../shared/types.js';

const bridgeRunner = new BridgeRunner();

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Forward bridge status changes to renderer
  bridgeRunner.on('statusChanged', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.BRIDGE_STATUS, status);
    }
  });

  // Forward bridge log messages to renderer
  bridgeRunner.on('log', (message: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.BRIDGE_LOG, message);
    }
  });

  // --- Auth ---

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, apiUrl: string, username: string, password: string) => {
    const result = await login(apiUrl, username, password);
    store.setApiUrl(apiUrl);
    store.setToken(result.accessToken);

    const authState = buildAuthState(apiUrl, result.username);
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_CHANGED, authState);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    if (bridgeRunner.isRunning) {
      await bridgeRunner.stop();
    }
    store.clearToken();

    const authState = buildAuthState(store.getApiUrl(), null);
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_CHANGED, authState);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATE, async () => {
    const apiUrl = store.getApiUrl();
    const token = store.getToken();

    if (!token) {
      return buildAuthState(apiUrl, null);
    }

    const username = await verifyToken(apiUrl, token);
    if (!username) {
      store.clearToken();
    }

    return buildAuthState(apiUrl, username);
  });

  // --- Events ---

  ipcMain.handle(IPC_CHANNELS.EVENTS_FETCH, async () => {
    const apiUrl = store.getApiUrl();
    const token = store.getToken();

    if (!token) {
      throw new Error('Not authenticated');
    }

    return fetchEvents(apiUrl, token);
  });

  // --- Bridge ---

  ipcMain.handle(IPC_CHANNELS.BRIDGE_START, async (_event, eventCode: string) => {
    store.setLastEventCode(eventCode);

    const apiUrl = store.getApiUrl();
    const token = store.getToken();

    if (!token) {
      throw new Error('Not authenticated');
    }

    const apiKey = await fetchBridgeApiKey(apiUrl, token);
    const settings = store.getSettings();

    await bridgeRunner.start({
      apiUrl,
      apiKey,
      eventCode,
      settings,
    });
  });

  ipcMain.handle(IPC_CHANNELS.BRIDGE_STOP, async () => {
    await bridgeRunner.stop();
  });

  // --- Settings ---

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return store.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_event, partial: Partial<BridgeSettings>) => {
    return store.updateSettings(partial);
  });
}

/**
 * Check stored auth on startup and return initial auth state.
 */
export async function checkStoredAuth(): Promise<void> {
  // Will be called from main.ts after window is ready
}

/**
 * Get the bridge runner instance (for cleanup on app quit).
 */
export function getBridgeRunner(): BridgeRunner {
  return bridgeRunner;
}
