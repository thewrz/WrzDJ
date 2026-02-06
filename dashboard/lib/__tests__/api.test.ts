import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    api.setToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('sends credentials as form data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token' }),
      });

      const result = await api.login('testuser', 'testpass');

      expect(result.access_token).toBe('test-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/auth/login');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('throws on invalid credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Invalid credentials' }),
      });

      await expect(api.login('bad', 'creds')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('getEvents', () => {
    it('fetches events with auth header', async () => {
      api.setToken('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, code: 'ABC123', name: 'Test Event' }],
      });

      const events = await api.getEvents();

      expect(events).toHaveLength(1);
      expect(events[0].code).toBe('ABC123');

      const [, options] = mockFetch.mock.calls[0];
      // Headers is a Headers object, use .get() to retrieve values
      expect(options.headers.get('Authorization')).toBe('Bearer test-token');
    });
  });

  describe('search', () => {
    it('encodes search query properly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await api.search('test song & artist');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('q=test%20song%20%26%20artist');
    });
  });

  describe('submitRequest', () => {
    it('sends song request data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1,
          artist: 'Artist',
          song_title: 'Title',
          status: 'new',
        }),
      });

      const result = await api.submitRequest('ABC123', 'Artist', 'Title', 'Please play!');

      expect(result.id).toBe(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/events/ABC123/requests');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.artist).toBe('Artist');
      expect(body.title).toBe('Title');
      expect(body.note).toBe('Please play!');
    });
  });

  describe('getPlayHistory', () => {
    it('fetches play history with default parameters', async () => {
      const mockHistoryResponse = {
        items: [
          {
            id: 1,
            title: 'Test Song',
            artist: 'Test Artist',
            album: 'Test Album',
            album_art_url: 'https://example.com/art.jpg',
            spotify_uri: 'spotify:track:123',
            matched_request_id: null,
            source: 'stagelinq',
            started_at: '2024-01-01T12:00:00Z',
            ended_at: '2024-01-01T12:03:00Z',
            play_order: 1,
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistoryResponse,
      });

      const result = await api.getPlayHistory('ABC123');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Song');
      expect(result.items[0].source).toBe('stagelinq');
      expect(result.total).toBe(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/public/e/ABC123/history');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=0');
    });

    it('fetches play history with custom limit and offset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      });

      await api.getPlayHistory('ABC123', 5, 10);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=5');
      expect(url).toContain('offset=10');
    });

    it('returns items with matched_request_id when request was fulfilled', async () => {
      const mockHistoryResponse = {
        items: [
          {
            id: 1,
            title: 'Requested Song',
            artist: 'Requested Artist',
            album: null,
            album_art_url: null,
            spotify_uri: null,
            matched_request_id: 42,
            source: 'stagelinq',
            started_at: '2024-01-01T12:00:00Z',
            ended_at: null,
            play_order: 1,
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistoryResponse,
      });

      const result = await api.getPlayHistory('ABC123');

      expect(result.items[0].matched_request_id).toBe(42);
    });

    it('throws ApiError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Event not found' }),
      });

      await expect(api.getPlayHistory('INVALID')).rejects.toThrow('Event not found');
    });

    it('returns empty items array when no history exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      });

      const result = await api.getPlayHistory('ABC123');

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('error handling', () => {
    it('throws with detail from error response', async () => {
      api.setToken('token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Event not found' }),
      });

      await expect(api.getEvent('INVALID')).rejects.toThrow('Event not found');
    });

    it('throws generic message when no detail', async () => {
      api.setToken('token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      await expect(api.getEvent('INVALID')).rejects.toThrow('Request failed');
    });
  });
});
