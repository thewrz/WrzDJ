import { ipcMain, type BrowserWindow } from 'electron';
import { login, verifyToken, buildAuthState } from './auth-service.js';
import { fetchBridgeApiKey } from './bridge-api-key-service.js';
import { fetchEvents } from './events-service.js';
import { listPluginMeta } from '@bridge/plugin-registry.js';
import { BridgeRunner } from './bridge-runner.js';
import * as store from './store.js';
import { IPC_CHANNELS } from '../shared/types.js';
import type { BridgeSettings } from '../shared/types.js';

const bridgeRunner = new BridgeRunner();

/** Validate that a value is a valid HTTP(S) URL. */
function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate that an event code matches the expected format. */
function isValidEventCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{4,10}$/.test(value);
}

/** Known BridgeSettings keys and their expected types. */
const SETTINGS_SCHEMA: Record<string, string> = {
  protocol: 'string',
  pluginConfig: 'object',
  liveThresholdSeconds: 'number',
  pauseGraceSeconds: 'number',
  nowPlayingPauseSeconds: 'number',
  useFaderDetection: 'boolean',
  masterDeckPriority: 'boolean',
  minPlaySeconds: 'number',
};

/** Validate and filter a settings update to only known keys with correct types. */
function validateSettingsUpdate(partial: unknown): Partial<BridgeSettings> {
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) {
    throw new Error('Invalid settings: expected an object');
  }
  const validated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(partial)) {
    const expectedType = SETTINGS_SCHEMA[key];
    if (!expectedType) continue; // skip unknown keys
    if (typeof value !== expectedType) continue; // skip wrong types
    validated[key] = value;
  }
  return validated as Partial<BridgeSettings>;
}

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
    if (!isValidHttpUrl(apiUrl)) {
      throw new Error('Invalid API URL: must be a valid HTTP or HTTPS URL');
    }
    const result = await login(apiUrl, username, password);
    store.setApiUrl(apiUrl);
    store.setToken(result.accessToken);

    const authState = buildAuthState(apiUrl, result.username);
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_CHANGED, authState);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    if (bridgeRunner.isRunning) {
      try {
        await bridgeRunner.stop();
      } catch {
        // Ensure logout completes even if bridge stop fails
      }
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

  // --- Plugins ---

  ipcMain.handle(IPC_CHANNELS.PLUGINS_LIST_META, () => {
    return listPluginMeta();
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
    if (!isValidEventCode(eventCode)) {
      throw new Error('Invalid event code: must be 4-10 alphanumeric characters');
    }
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
    const validated = validateSettingsUpdate(partial);
    return store.updateSettings(validated);
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
