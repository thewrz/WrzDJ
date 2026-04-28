import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@thumbmarkjs/thumbmarkjs', () => ({
  setOption: vi.fn(),
  getFingerprint: vi.fn().mockResolvedValue({ hash: 'mock_hash_value', data: {} }),
}));

describe('useGuestIdentity (F6)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks isReturning=false when server returns action=create', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guest_id: 7, action: 'create' }),
      headers: { get: () => null },
    });

    // Dynamic import after mocks are set up — resets module-level cache
    const { useGuestIdentity } = await import('../use-guest-identity');
    const { result } = renderHook(() => useGuestIdentity());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.guestId).toBe(7);
    expect(result.current.isReturning).toBe(false);
  });

  it('marks isReturning=true when server returns action=cookie_hit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guest_id: 8, action: 'cookie_hit' }),
      headers: { get: () => null },
    });

    const { useGuestIdentity } = await import('../use-guest-identity');
    const { result } = renderHook(() => useGuestIdentity());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.guestId).toBe(8);
    expect(result.current.isReturning).toBe(true);
  });
});
