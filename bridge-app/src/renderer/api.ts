import type { AuthState, BridgeSettings, BridgeStatus, EventInfo } from '../shared/types.js';

/**
 * Type-safe wrapper around the bridgeApi exposed via contextBridge.
 */
export interface BridgeApi {
  login(apiUrl: string, username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getAuthState(): Promise<AuthState>;
  fetchEvents(): Promise<readonly EventInfo[]>;
  startBridge(eventCode: string): Promise<void>;
  stopBridge(): Promise<void>;
  getSettings(): Promise<BridgeSettings>;
  updateSettings(settings: Partial<BridgeSettings>): Promise<BridgeSettings>;
  onBridgeStatus(callback: (status: BridgeStatus) => void): () => void;
  onAuthChanged(callback: (state: AuthState) => void): () => void;
}

declare global {
  interface Window {
    bridgeApi: BridgeApi;
  }
}

export const api: BridgeApi = window.bridgeApi;
