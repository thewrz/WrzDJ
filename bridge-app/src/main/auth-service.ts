import type { AuthState } from '../shared/types.js';

export interface LoginResult {
  readonly accessToken: string;
  readonly username: string;
}

/**
 * Authenticate against the WrzDJ backend.
 * Uses the same OAuth2 password flow as the dashboard.
 */
export async function login(
  apiUrl: string,
  username: string,
  password: string,
): Promise<LoginResult> {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);

  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Login failed' }));
    throw new Error(error.detail || 'Login failed');
  }

  const data = await response.json();
  return { accessToken: data.access_token, username };
}

/**
 * Verify a stored token is still valid by calling /api/auth/me.
 * Returns the username if valid, null if expired/invalid.
 */
export async function verifyToken(
  apiUrl: string,
  token: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.username || null;
  } catch {
    return null;
  }
}

/** Build an AuthState object */
export function buildAuthState(
  apiUrl: string,
  username: string | null,
): AuthState {
  return {
    isAuthenticated: username !== null,
    username,
    apiUrl,
  };
}
