/**
 * Cloudflare Turnstile loader + site-key cache.
 *
 * Used by the human-verification bootstrap on guest pages (/join, /collect).
 * Loads the Turnstile JS once per page session and caches the site key
 * fetched from /api/auth/settings.
 *
 * Spec: docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md
 */

import { api } from './api';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: TurnstileOptions
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
      ready: (callback: () => void) => void;
    };
  }
}

export interface TurnstileOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  appearance?: 'always' | 'execute' | 'interaction-only';
  size?: 'normal' | 'flexible' | 'compact' | 'invisible';
  theme?: 'light' | 'dark' | 'auto';
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptLoadPromise: Promise<void> | null = null;
let cachedSiteKey: string | null = null;

export async function getTurnstileSiteKey(): Promise<string> {
  if (cachedSiteKey !== null) return cachedSiteKey;
  const settings = await api.getPublicSettings();
  cachedSiteKey = settings.turnstile_site_key || '';
  return cachedSiteKey;
}

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile script failed to load'));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export function resetTurnstileCache(): void {
  cachedSiteKey = null;
}
