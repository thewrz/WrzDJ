'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import { getTurnstileSiteKey, loadTurnstileScript } from './turnstile';

export type HumanVerificationState =
  | 'idle'
  | 'loading'
  | 'verified'
  | 'challenge'
  | 'failed';

export interface UseHumanVerification {
  state: HumanVerificationState;
  ensureVerified: () => Promise<void>;
  reverify: () => Promise<void>;
  widgetContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useHumanVerification(): UseHumanVerification {
  const [state, setState] = useState<HumanVerificationState>('idle');
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const verifiedResolversRef = useRef<Array<() => void>>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const submitToken = useCallback(async (token: string) => {
    try {
      const result = await api.verifyHuman(token);
      if (result.verified) {
        setState('verified');
        verifiedResolversRef.current.forEach((resolve) => resolve());
        verifiedResolversRef.current = [];
      } else {
        setState('failed');
      }
    } catch {
      setState('failed');
    }
  }, []);

  const renderWidget = useCallback(async () => {
    setState('loading');
    const sitekey = await getTurnstileSiteKey();
    if (!sitekey) {
      // No site key configured (dev / Turnstile-disabled deploy) — treat as verified
      setState('verified');
      verifiedResolversRef.current.forEach((resolve) => resolve());
      verifiedResolversRef.current = [];
      return;
    }
    await loadTurnstileScript();
    if (!window.turnstile) return;

    // Use ref container if attached; otherwise create a hidden fallback container
    let container = widgetContainerRef.current;
    if (!container) {
      container = document.createElement('div');
      container.style.display = 'none';
      document.body.appendChild(container);
    }

    if (widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      return;
    }

    widgetIdRef.current = window.turnstile.render(container, {
      sitekey,
      appearance: 'interaction-only',
      size: 'normal',
      callback: (token: string) => {
        void submitToken(token);
      },
      'error-callback': () => setState('failed'),
      'expired-callback': () => {
        setState('idle');
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    });
  }, [submitToken]);

  useEffect(() => {
    void renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  const ensureVerified = useCallback((): Promise<void> => {
    if (stateRef.current === 'verified') return Promise.resolve();
    return new Promise((resolve) => {
      verifiedResolversRef.current.push(resolve);
    });
  }, []);

  const reverify = useCallback(async () => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    setState('loading');
    await renderWidget();
  }, [renderWidget]);

  return { state, ensureVerified, reverify, widgetContainerRef };
}
