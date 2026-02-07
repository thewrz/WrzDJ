import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import type { AuthState } from '../../shared/types.js';

const INITIAL_STATE: AuthState = {
  isAuthenticated: false,
  username: null,
  apiUrl: 'https://api.wrzdj.com',
};

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check stored auth on mount
    api.getAuthState().then((state) => {
      setAuthState(state);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Subscribe to auth changes
    const unsubscribe = api.onAuthChanged((state) => {
      setAuthState(state);
      setError(null);
    });

    return unsubscribe;
  }, []);

  const login = useCallback(async (apiUrl: string, username: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      await api.login(apiUrl, username, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
  }, []);

  return { authState, loading, error, login, logout };
}
