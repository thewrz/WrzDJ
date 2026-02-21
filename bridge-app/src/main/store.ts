import Store from 'electron-store';
import { safeStorage } from 'electron';
import { DEFAULT_SETTINGS, type BridgeSettings } from '../shared/types.js';

interface StoreSchema {
  apiUrl: string;
  encryptedToken: string;
  lastEventCode: string;
  settings: BridgeSettings;
}

const store = new Store<StoreSchema>({
  defaults: {
    apiUrl: 'https://api.wrzdj.com',
    encryptedToken: '',
    lastEventCode: '',
    settings: DEFAULT_SETTINGS,
  },
});

// In-memory fallback when OS keychain encryption is unavailable.
// Token is lost on app restart — user must re-authenticate.
let sessionToken: string | null = null;

export function getApiUrl(): string {
  return store.get('apiUrl');
}

export function setApiUrl(url: string): void {
  store.set('apiUrl', url);
}

export function getToken(): string | null {
  const encrypted = store.get('encryptedToken');

  if (!safeStorage.isEncryptionAvailable()) {
    return sessionToken;
  }

  if (!encrypted) return null;

  try {
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    store.set('encryptedToken', '');
    return null;
  }
}

export function setToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Store] OS keychain encryption unavailable — token stored in memory only');
    sessionToken = token;
    return;
  }

  try {
    const encrypted = safeStorage.encryptString(token);
    store.set('encryptedToken', encrypted.toString('base64'));
  } catch {
    console.warn('[Store] Token encryption failed — storing in memory only');
    sessionToken = token;
  }
}

export function clearToken(): void {
  store.set('encryptedToken', '');
  sessionToken = null;
}

export function getLastEventCode(): string {
  return store.get('lastEventCode');
}

export function setLastEventCode(code: string): void {
  store.set('lastEventCode', code);
}

export function getSettings(): BridgeSettings {
  return store.get('settings');
}

export function updateSettings(partial: Partial<BridgeSettings>): BridgeSettings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  store.set('settings', updated);
  return updated;
}
