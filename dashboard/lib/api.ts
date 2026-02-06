export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function getApiUrl(): string {
  // Use explicit env var if set
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // In browser, use same hostname as the page (for LAN access)
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:8000`;
  }
  // SSR fallback
  return 'http://localhost:8000';
}

export interface Event {
  id: number;
  code: string;
  name: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  join_url: string | null;
}

export interface ArchivedEvent extends Event {
  status: 'expired' | 'archived';
  request_count: number;
  archived_at: string | null;
}

export interface SongRequest {
  id: number;
  event_id: number;
  song_title: string;
  artist: string;
  source: string;
  source_url: string | null;
  artwork_url: string | null;
  note: string | null;
  status: 'new' | 'accepted' | 'playing' | 'played' | 'rejected';
  created_at: string;
  updated_at: string;
  is_duplicate?: boolean;
}

export interface PublicRequestInfo {
  id: number;
  title: string;
  artist: string;
  artwork_url: string | null;
}

export interface KioskDisplay {
  event: { code: string; name: string };
  qr_join_url: string;
  accepted_queue: PublicRequestInfo[];
  now_playing: PublicRequestInfo | null;
  updated_at: string;
}

export interface SearchResult {
  artist: string;
  title: string;
  album: string | null;
  popularity: number;
  spotify_id: string | null;
  album_art: string | null;
  preview_url: string | null;
  url: string | null;
}

/** StageLinQ now-playing track info */
export interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
  spotify_uri: string | null;
  started_at: string;
  source: string;
  matched_request_id: number | null;
  bridge_connected: boolean;
}

/** Single entry in play history */
export interface PlayHistoryItem {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
  spotify_uri: string | null;
  matched_request_id: number | null;
  source: string;
  started_at: string;
  ended_at: string | null;
  play_order: number;
}

/** Paginated play history response */
export interface PlayHistoryResponse {
  items: PlayHistoryItem[];
  total: number;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers({
      'Content-Type': 'application/json',
    });

    if (options.headers) {
      new Headers(options.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(`${getApiUrl()}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }

    return response.json();
  }

  async login(username: string, password: string): Promise<{ access_token: string }> {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const response = await fetch(`${getApiUrl()}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Invalid credentials');
    }

    return response.json();
  }

  async getMe(): Promise<{ id: number; username: string }> {
    return this.fetch('/api/auth/me');
  }

  async getEvents(): Promise<Event[]> {
    return this.fetch('/api/events');
  }

  async createEvent(name: string, expiresHours: number = 6): Promise<Event> {
    return this.fetch('/api/events', {
      method: 'POST',
      body: JSON.stringify({ name, expires_hours: expiresHours }),
    });
  }

  async getEvent(code: string): Promise<Event> {
    return this.fetch(`/api/events/${code}`);
  }

  async updateEvent(code: string, data: { expires_at?: string; name?: string }): Promise<Event> {
    return this.fetch(`/api/events/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteEvent(code: string): Promise<void> {
    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    const response = await fetch(`${getApiUrl()}/api/events/${code}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail || 'Delete failed');
    }
  }

  async getRequests(code: string, status?: string): Promise<SongRequest[]> {
    const params = status ? `?status=${status}` : '';
    return this.fetch(`/api/events/${code}/requests${params}`);
  }

  async updateRequestStatus(requestId: number, status: string): Promise<SongRequest> {
    return this.fetch(`/api/requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async submitRequest(
    code: string,
    artist: string,
    title: string,
    note?: string,
    sourceUrl?: string,
    artworkUrl?: string
  ): Promise<SongRequest> {
    return this.fetch(`/api/events/${code}/requests`, {
      method: 'POST',
      body: JSON.stringify({
        artist,
        title,
        note,
        source: 'spotify',
        source_url: sourceUrl,
        artwork_url: artworkUrl,
      }),
    });
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.fetch(`/api/search?q=${encodeURIComponent(query)}`);
  }

  async getArchivedEvents(): Promise<ArchivedEvent[]> {
    return this.fetch('/api/events/archived');
  }

  async exportEventCsv(code: string): Promise<void> {
    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(`${getApiUrl()}/api/events/${code}/export/csv`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Export failed' }));
      throw new ApiError(error.detail || 'Export failed', response.status);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition?.match(/filename=([^;]+)/);
    a.download = filenameMatch ? filenameMatch[1].replace(/"/g, '') : `${code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async exportPlayHistoryCsv(code: string): Promise<void> {
    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(`${getApiUrl()}/api/events/${code}/export/play-history/csv`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Export failed' }));
      throw new ApiError(error.detail || 'Export failed', response.status);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition?.match(/filename=([^;]+)/);
    a.download = filenameMatch ? filenameMatch[1].replace(/"/g, '') : `${code}_play_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async getKioskDisplay(code: string): Promise<KioskDisplay> {
    // Public endpoint, no auth needed
    const response = await fetch(`${getApiUrl()}/api/public/events/${code}/display`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }
    return response.json();
  }

  /**
   * Get current now-playing track from StageLinQ.
   * Returns null if no track is playing.
   */
  async getNowPlaying(code: string): Promise<NowPlayingInfo | null> {
    const response = await fetch(`${getApiUrl()}/api/public/e/${code}/nowplaying`);
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        throw new ApiError('Event not found', response.status);
      }
      return null;
    }
    const data = await response.json();
    return data || null;
  }

  /**
   * Get play history for an event.
   */
  async getPlayHistory(code: string, limit: number = 100, offset: number = 0): Promise<PlayHistoryResponse> {
    const response = await fetch(
      `${getApiUrl()}/api/public/e/${code}/history?limit=${limit}&offset=${offset}`
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }
    return response.json();
  }
}

export const api = new ApiClient();
