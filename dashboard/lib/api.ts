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
  // Banner
  banner_url: string | null;
  banner_kiosk_url: string | null;
  banner_colors: string[] | null;
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
  // Voting
  vote_count: number;
}

export interface PublicRequestInfo {
  id: number;
  title: string;
  artist: string;
  artwork_url: string | null;
  vote_count: number;
}

export interface GuestRequestInfo extends PublicRequestInfo {
  status: 'new' | 'accepted';
}

export interface GuestRequestListResponse {
  event: { code: string; name: string };
  requests: GuestRequestInfo[];
}

export interface HasRequestedResponse {
  has_requested: boolean;
}

export interface VoteResponse {
  status: string;
  vote_count: number;
  has_voted: boolean;
}

export interface KioskDisplay {
  event: { code: string; name: string };
  qr_join_url: string;
  accepted_queue: PublicRequestInfo[];
  now_playing: PublicRequestInfo | null;
  now_playing_hidden: boolean;
  updated_at: string;
  banner_url: string | null;
  banner_kiosk_url: string | null;
  banner_colors: string[] | null;
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

    if (response.status === 204) {
      return undefined as T;
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

  async getMe(): Promise<{ id: number; username: string; role: string }> {
    return this.fetch('/api/auth/me');
  }

  async getPublicSettings(): Promise<{ registration_enabled: boolean; turnstile_site_key: string }> {
    const response = await fetch(`${getApiUrl()}/api/auth/settings`);
    if (!response.ok) {
      throw new ApiError('Failed to load settings', response.status);
    }
    return response.json();
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    confirm_password: string;
    turnstile_token: string;
  }): Promise<{ status: string; message: string }> {
    const response = await fetch(`${getApiUrl()}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Registration failed' }));
      throw new ApiError(error.detail || 'Registration failed', response.status);
    }
    return response.json();
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

  async acceptAllRequests(code: string): Promise<{ status: string; accepted_count: number }> {
    return this.fetch(`/api/events/${code}/requests/accept-all`, {
      method: 'POST',
    });
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

  async voteRequest(requestId: number): Promise<VoteResponse> {
    return this.fetch(`/api/requests/${requestId}/vote`, { method: 'POST' });
  }

  async unvoteRequest(requestId: number): Promise<VoteResponse> {
    return this.fetch(`/api/requests/${requestId}/vote`, { method: 'DELETE' });
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

  async checkHasRequested(code: string): Promise<HasRequestedResponse> {
    const response = await fetch(`${getApiUrl()}/api/public/events/${code}/has-requested`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }
    return response.json();
  }

  async getPublicRequests(code: string): Promise<GuestRequestListResponse> {
    const response = await fetch(`${getApiUrl()}/api/public/events/${code}/requests`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }
    return response.json();
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
  // ========== Banner ==========

  async uploadEventBanner(code: string, file: File): Promise<Event> {
    const formData = new FormData();
    formData.append('file', file);

    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    // Do NOT set Content-Type — browser sets it with multipart boundary

    const response = await fetch(`${getApiUrl()}/api/events/${code}/banner`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new ApiError(error.detail || 'Upload failed', response.status);
    }

    return response.json();
  }

  async deleteEventBanner(code: string): Promise<Event> {
    return this.fetch(`/api/events/${code}/banner`, { method: 'DELETE' });
  }

  // ========== Admin ==========

  async getAdminStats(): Promise<SystemStats> {
    return this.fetch('/api/admin/stats');
  }

  async getAdminUsers(
    page: number = 1,
    limit: number = 20,
    role?: string
  ): Promise<PaginatedResponse<AdminUser>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (role) params.set('role', role);
    return this.fetch(`/api/admin/users?${params}`);
  }

  async createAdminUser(data: {
    username: string;
    password: string;
    role: string;
  }): Promise<AdminUser> {
    return this.fetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminUser(
    userId: number,
    data: { role?: string; is_active?: boolean; password?: string }
  ): Promise<AdminUser> {
    return this.fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminUser(userId: number): Promise<void> {
    await this.fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
  }

  async getAdminEvents(
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<AdminEvent>> {
    return this.fetch(`/api/admin/events?page=${page}&limit=${limit}`);
  }

  async updateAdminEvent(
    code: string,
    data: { name?: string; expires_at?: string }
  ): Promise<AdminEvent> {
    return this.fetch(`/api/admin/events/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminEvent(code: string): Promise<void> {
    await this.fetch(`/api/admin/events/${code}`, { method: 'DELETE' });
  }

  async getAdminSettings(): Promise<SystemSettings> {
    return this.fetch('/api/admin/settings');
  }

  async updateAdminSettings(data: Partial<SystemSettings>): Promise<SystemSettings> {
    return this.fetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
}

export interface SystemStats {
  total_users: number;
  active_users: number;
  pending_users: number;
  total_events: number;
  active_events: number;
  total_requests: number;
}

export interface AdminUser {
  id: number;
  username: string;
  is_active: boolean;
  role: string;
  created_at: string;
  event_count: number;
}

export interface AdminEvent {
  id: number;
  code: string;
  name: string;
  owner_username: string;
  owner_id: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  request_count: number;
}

export interface SystemSettings {
  registration_enabled: boolean;
  search_rate_limit_per_minute: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const api = new ApiClient();
