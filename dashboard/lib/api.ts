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

export interface SongRequest {
  id: number;
  event_id: number;
  song_title: string;
  artist: string;
  source: string;
  source_url: string | null;
  note: string | null;
  status: 'new' | 'playing' | 'played' | 'rejected';
  created_at: string;
  updated_at: string;
  is_duplicate?: boolean;
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

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${getApiUrl()}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || 'Request failed');
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
    const headers: HeadersInit = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
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
    sourceUrl?: string
  ): Promise<SongRequest> {
    return this.fetch(`/api/events/${code}/requests`, {
      method: 'POST',
      body: JSON.stringify({ artist, title, note, source: 'spotify', source_url: sourceUrl }),
    });
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.fetch(`/api/search?q=${encodeURIComponent(query)}`);
  }
}

export const api = new ApiClient();
