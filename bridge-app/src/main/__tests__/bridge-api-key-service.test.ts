import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBridgeApiKey } from '../bridge-api-key-service.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchBridgeApiKey', () => {
  it('returns the bridge API key on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bridge_api_key: 'my-secret-key' }),
    });

    const key = await fetchBridgeApiKey('https://api.wrzdj.com', 'token-123');

    expect(key).toBe('my-secret-key');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wrzdj.com/api/bridge/apikey',
      { headers: { Authorization: 'Bearer token-123' } },
    );
  });

  it('throws on 401 with session expired message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Unauthorized' }),
    });

    await expect(fetchBridgeApiKey('https://api.wrzdj.com', 'bad-token'))
      .rejects.toThrow('Session expired');
  });

  it('throws on 404 with server update message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Not Found' }),
    });

    await expect(fetchBridgeApiKey('https://api.wrzdj.com', 'token'))
      .rejects.toThrow('server is updated');
  });

  it('throws on 503 with not configured message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ detail: 'Bridge API key not configured' }),
    });

    await expect(fetchBridgeApiKey('https://api.wrzdj.com', 'token'))
      .rejects.toThrow('Bridge API key not configured on server');
  });

  it('throws with detail on other errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Internal server error' }),
    });

    await expect(fetchBridgeApiKey('https://api.wrzdj.com', 'token'))
      .rejects.toThrow('Internal server error');
  });
});
