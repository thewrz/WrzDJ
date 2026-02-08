import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AuthState, BridgeSettings, BridgeStatus, EventInfo } from '../shared/types.js';
import { IPC_CHANNELS } from '../shared/types.js';

const bridgeApi = {
  // Auth
  login: (apiUrl: string, username: string, password: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, apiUrl, username, password),

  logout: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),

  getAuthState: (): Promise<AuthState> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATE),

  // Events
  fetchEvents: (): Promise<readonly EventInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.EVENTS_FETCH),

  // Bridge control
  startBridge: (eventCode: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_START, eventCode),

  stopBridge: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_STOP),

  // Settings
  getSettings: (): Promise<BridgeSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

  updateSettings: (settings: Partial<BridgeSettings>): Promise<BridgeSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),

  // Status subscriptions (main -> renderer)
  onBridgeStatus: (callback: (status: BridgeStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: BridgeStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.BRIDGE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BRIDGE_STATUS, listener);
  },

  onAuthChanged: (callback: (state: AuthState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: AuthState) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.AUTH_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld('bridgeApi', bridgeApi);

export type BridgeApi = typeof bridgeApi;
