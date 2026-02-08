import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, verifyToken, buildAuthState } from '../auth-service.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('sends form-encoded POST and returns token + username', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'jwt-token-123', token_type: 'bearer' }),
    });

    const result = await login('https://api.wrzdj.com', 'admin', 'pass123');

    expect(result).toEqual({ accessToken: 'jwt-token-123', username: 'admin' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wrzdj.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    // Verify form body contains username and password
    const callArgs = mockFetch.mock.calls[0][1];
    const body = callArgs.body as URLSearchParams;
    expect(body.get('username')).toBe('admin');
    expect(body.get('password')).toBe('pass123');
  });

  it('throws on 401 with detail message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Invalid credentials' }),
    });

    await expect(login('https://api.wrzdj.com', 'admin', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('throws generic message when response has no detail', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('parse error')),
    });

    await expect(login('https://api.wrzdj.com', 'admin', 'pass')).rejects.toThrow('Login failed');
  });
});

describe('verifyToken', () => {
  it('returns username when token is valid', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'admin' }),
    });

    const result = await verifyToken('https://api.wrzdj.com', 'valid-token');

    expect(result).toBe('admin');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wrzdj.com/api/auth/me',
      { headers: { Authorization: 'Bearer valid-token' } },
    );
  });

  it('returns null when token is expired', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await verifyToken('https://api.wrzdj.com', 'expired-token');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await verifyToken('https://api.wrzdj.com', 'any-token');
    expect(result).toBeNull();
  });
});

describe('buildAuthState', () => {
  it('builds authenticated state', () => {
    const state = buildAuthState('https://api.wrzdj.com', 'admin');
    expect(state).toEqual({
      isAuthenticated: true,
      username: 'admin',
      apiUrl: 'https://api.wrzdj.com',
    });
  });

  it('builds unauthenticated state', () => {
    const state = buildAuthState('https://api.wrzdj.com', null);
    expect(state).toEqual({
      isAuthenticated: false,
      username: null,
      apiUrl: 'https://api.wrzdj.com',
    });
  });
});
