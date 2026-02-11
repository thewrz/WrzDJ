import type {
  AdminEvent,
  AdminUser,
  ArchivedEvent,
  DisplaySettingsResponse,
  Event,
  GuestRequestListResponse,
  HasRequestedResponse,
  KioskDisplay,
  NowPlayingInfo,
  PaginatedResponse,
  PlayHistoryResponse,
  SearchResult,
  SongRequest,
  SystemSettings,
  SystemStats,
  TidalEventSettings,
  TidalSearchResult,
  TidalSyncResult,
  TidalStatus,
  VoteResponse,
} from './api-types';

export type {
  AdminEvent,
  AdminUser,
  ArchivedEvent,
  DisplaySettingsResponse,
  Event,
  GuestRequestInfo,
  GuestRequestListResponse,
  HasRequestedResponse,
  KioskDisplay,
  NowPlayingInfo,
  PaginatedResponse,
  PlayHistoryItem,
  PlayHistoryResponse,
  PublicRequestInfo,
  SearchResult,
  SongRequest,
  SystemSettings,
  SystemStats,
  TidalEventSettings,
  TidalSearchResult,
  TidalSyncResult,
  TidalStatus,
  VoteResponse,
} from './api-types';

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

class ApiClient {
  private token: string | null = null;
  private onUnauthorized: (() => void) | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  /**
   * Register a callback for 401 responses on authenticated endpoints.
   * Used by AuthProvider to auto-logout on token expiration.
   */
  setUnauthorizedHandler(handler: (() => void) | null) {
    this.onUnauthorized = handler;
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
      if (response.status === 401 && this.onUnauthorized) {
        this.onUnauthorized();
      }
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Fetch a public (no-auth) endpoint and parse JSON response.
   * Throws ApiError on non-OK responses.
   */
  private async publicFetch<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new ApiError(error.detail || 'Request failed', response.status);
    }
    return response.json();
  }

  /**
   * Download a CSV blob from an authenticated endpoint and trigger browser download.
   * Parses filename from Content-Disposition header, falling back to the provided default.
   */
  private async downloadCsvBlob(url: string, defaultFilename: string): Promise<void> {
    const headers = new Headers();
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 401 && this.onUnauthorized) {
        this.onUnauthorized();
      }
      const error = await response.json().catch(() => ({ detail: 'Export failed' }));
      throw new ApiError(error.detail || 'Export failed', response.status);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition?.match(/filename=([^;]+)/);
    a.download = filenameMatch ? filenameMatch[1].replace(/"/g, '') : defaultFilename;
    a.click();
    URL.revokeObjectURL(blobUrl);
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
      if (response.status === 401) {
        throw new Error('Invalid credentials');
      } else if (response.status === 429) {
        throw new Error('Too many attempts. Try again later.');
      }
      throw new Error('Login failed. Please try again.');
    }

    return response.json();
  }

  async getMe(): Promise<{ id: number; username: string; role: string }> {
    return this.fetch('/api/auth/me');
  }

  async getPublicSettings(): Promise<{ registration_enabled: boolean; turnstile_site_key: string }> {
    return this.publicFetch(`${getApiUrl()}/api/auth/settings`);
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
    return this.downloadCsvBlob(
      `${getApiUrl()}/api/events/${code}/export/csv`,
      `${code}.csv`
    );
  }

  async exportPlayHistoryCsv(code: string): Promise<void> {
    return this.downloadCsvBlob(
      `${getApiUrl()}/api/events/${code}/export/play-history/csv`,
      `${code}_play_history.csv`
    );
  }

  async checkHasRequested(code: string): Promise<HasRequestedResponse> {
    return this.publicFetch(`${getApiUrl()}/api/public/events/${code}/has-requested`);
  }

  async getPublicRequests(code: string): Promise<GuestRequestListResponse> {
    return this.publicFetch(`${getApiUrl()}/api/public/events/${code}/requests`);
  }

  async getKioskDisplay(code: string): Promise<KioskDisplay> {
    return this.publicFetch(`${getApiUrl()}/api/public/events/${code}/display`);
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
    return this.publicFetch(
      `${getApiUrl()}/api/public/e/${code}/history?limit=${limit}&offset=${offset}`
    );
  }

  /**
   * Set now playing visibility on kiosk display.
   * When hidden=true, the now playing section will be hidden on the kiosk.
   * When hidden=false, the now playing section will be shown and the auto-hide timer resets.
   */
  async setNowPlayingVisibility(
    code: string,
    hidden: boolean,
    autoHideMinutes?: number,
  ): Promise<DisplaySettingsResponse> {
    const body: Record<string, unknown> = { now_playing_hidden: hidden };
    if (autoHideMinutes !== undefined) {
      body.now_playing_auto_hide_minutes = autoHideMinutes;
    }
    return this.fetch(`/api/events/${code}/display-settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update only the auto-hide timeout without affecting visibility state.
   */
  async setAutoHideMinutes(code: string, minutes: number): Promise<DisplaySettingsResponse> {
    return this.fetch(`/api/events/${code}/display-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ now_playing_auto_hide_minutes: minutes }),
    });
  }

  /**
   * Get current display settings for an event.
   */
  async getDisplaySettings(code: string): Promise<DisplaySettingsResponse> {
    return this.fetch(`/api/events/${code}/display-settings`);
  }

  /**
   * Open or close song requests for an event.
   */
  async setRequestsOpen(code: string, open: boolean): Promise<DisplaySettingsResponse> {
    return this.fetch(`/api/events/${code}/display-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ requests_open: open }),
    });
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
      if (response.status === 401 && this.onUnauthorized) {
        this.onUnauthorized();
      }
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

export const api = new ApiClient();
