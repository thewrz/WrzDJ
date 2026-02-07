import Store from 'electron-store';
import { safeStorage } from 'electron';
import { DEFAULT_SETTINGS, type BridgeSettings } from '../shared/types.js';

interface StoreSchema {
  apiUrl: string;
  encryptedToken: string;
  lastEventCode: string;
  apiKey: string;
  settings: BridgeSettings;
}

const store = new Store<StoreSchema>({
  defaults: {
    apiUrl: 'https://api.wrzdj.com',
    encryptedToken: '',
    lastEventCode: '',
    apiKey: '',
    settings: DEFAULT_SETTINGS,
  },
});

export function getApiUrl(): string {
  return store.get('apiUrl');
}

export function setApiUrl(url: string): void {
  store.set('apiUrl', url);
}

export function getToken(): string | null {
  const encrypted = store.get('encryptedToken');
  if (!encrypted) return null;

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return encrypted;
    }
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    store.set('encryptedToken', '');
    return null;
  }
}

export function setToken(token: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      store.set('encryptedToken', encrypted.toString('base64'));
    } else {
      store.set('encryptedToken', token);
    }
  } catch {
    store.set('encryptedToken', token);
  }
}

export function clearToken(): void {
  store.set('encryptedToken', '');
}

export function getLastEventCode(): string {
  return store.get('lastEventCode');
}

export function setLastEventCode(code: string): void {
  store.set('lastEventCode', code);
}

export function getApiKey(): string {
  return store.get('apiKey');
}

export function setApiKey(key: string): void {
  store.set('apiKey', key);
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
