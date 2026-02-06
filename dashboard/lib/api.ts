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
  // Tidal sync settings
  tidal_sync_enabled: boolean;
  tidal_playlist_id: string | null;
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
  // Tidal sync status
  tidal_track_id: string | null;
  tidal_sync_status: 'pending' | 'synced' | 'not_found' | 'error' | null;
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
  now_playing_hidden: boolean;
  updated_at: string;
}

export interface DisplaySettingsResponse {
  status: string;
  now_playing_hidden: boolean;
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

/** Tidal account status */
export interface TidalStatus {
  linked: boolean;
  user_id: string | null;
  expires_at: string | null;
}

/** Tidal search result */
export interface TidalSearchResult {
  track_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  tidal_url: string | null;
}

/** Tidal event settings */
export interface TidalEventSettings {
  tidal_sync_enabled: boolean;
  tidal_playlist_id: string | null;
}

/** Tidal sync result */
export interface TidalSyncResult {
  request_id: number;
  status: 'pending' | 'synced' | 'not_found' | 'error';
  tidal_track_id: string | null;
  error: string | null;
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

  /**
   * Set now playing visibility on kiosk display.
   * When hidden=true, the now playing section will be hidden on the kiosk.
   * When hidden=false, the now playing section will be shown and the 60-minute timer resets.
   */
  async setNowPlayingVisibility(code: string, hidden: boolean): Promise<DisplaySettingsResponse> {
    return this.fetch(`/api/events/${code}/display-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ now_playing_hidden: hidden }),
    });
  }

  /**
   * Get current display settings for an event.
   */
  async getDisplaySettings(code: string): Promise<DisplaySettingsResponse> {
    return this.fetch(`/api/events/${code}/display-settings`);
  }

  // ========== Tidal Integration ==========

  /**
   * Get Tidal account status for current user.
   */
  async getTidalStatus(): Promise<TidalStatus> {
    return this.fetch('/api/tidal/status');
  }

  /**
   * Start Tidal device login flow.
   * Returns URL and code for user to visit.
   */
  async startTidalAuth(): Promise<{ verification_url: string; user_code: string; message: string }> {
    return this.fetch('/api/tidal/auth/start', { method: 'POST' });
  }

  /**
   * Check if Tidal device login is complete.
   */
  async checkTidalAuth(): Promise<{ complete: boolean; pending?: boolean; error?: string; verification_url?: string; user_code?: string; user_id?: string }> {
    return this.fetch('/api/tidal/auth/check');
  }

  /**
   * Cancel pending Tidal device login.
   */
  async cancelTidalAuth(): Promise<{ status: string; message: string }> {
    return this.fetch('/api/tidal/auth/cancel', { method: 'POST' });
  }

  /**
   * Disconnect Tidal account.
   */
  async disconnectTidal(): Promise<{ status: string; message: string }> {
    return this.fetch('/api/tidal/disconnect', { method: 'POST' });
  }

  /**
   * Get Tidal sync settings for an event.
   */
  async getTidalEventSettings(eventId: number): Promise<TidalEventSettings> {
    return this.fetch(`/api/tidal/events/${eventId}/settings`);
  }

  /**
   * Update Tidal sync settings for an event.
   */
  async updateTidalEventSettings(
    eventId: number,
    settings: { tidal_sync_enabled: boolean }
  ): Promise<TidalEventSettings> {
    return this.fetch(`/api/tidal/events/${eventId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  /**
   * Search Tidal for tracks (for manual linking).
   */
  async searchTidal(query: string, limit: number = 10): Promise<TidalSearchResult[]> {
    return this.fetch(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  /**
   * Manually sync a request to Tidal.
   */
  async syncRequestToTidal(requestId: number): Promise<TidalSyncResult> {
    return this.fetch(`/api/tidal/requests/${requestId}/sync`, { method: 'POST' });
  }

  /**
   * Manually link a Tidal track to a request.
   */
  async linkTidalTrack(requestId: number, tidalTrackId: string): Promise<TidalSyncResult> {
    return this.fetch(`/api/tidal/requests/${requestId}/link`, {
      method: 'POST',
      body: JSON.stringify({ tidal_track_id: tidalTrackId }),
    });
  }
}

export const api = new ApiClient();
