import { expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Environment ──────────────────────────────────────────────────────────────

export const USERNAME = process.env.SCREENSHOT_USERNAME || 'admin';
export const PASSWORD = process.env.SCREENSHOT_PASSWORD || 'admin123';
export const API_PORT = process.env.SCREENSHOT_API_PORT || '8443';

// ─── Standard test tracks with varied metadata for scoring/enrichment tests ──

export const TEST_TRACKS = [
  { title: 'Strobe', artist: 'deadmau5', bpm: 128, musical_key: '8A', genre: 'Progressive House' },
  { title: 'Sandstorm', artist: 'Darude', bpm: 136, musical_key: '2A', genre: 'Trance' },
  { title: 'Blue Monday', artist: 'New Order', bpm: 130, musical_key: '9B', genre: 'Synth Pop' },
  { title: 'One More Time', artist: 'Daft Punk', bpm: 122, musical_key: '7A', genre: 'House' },
] as const;

// ─── API Origin ───────────────────────────────────────────────────────────────

export function getApiOrigin(baseURL: string): string {
  const url = new URL(baseURL);
  url.port = API_PORT;
  return url.origin;
}

// ─── Test API Context ─────────────────────────────────────────────────────────

export interface TestApi {
  api: APIRequestContext;
  jwt: string;
  apiOrigin: string;
  createEvent(name: string): Promise<{ code: string; id: number }>;
  seedRequest(eventCode: string, track: { title: string; artist: string; bpm?: number; musical_key?: string; genre?: string }): Promise<{ id: number }>;
  seedRequests(eventCode: string, tracks?: typeof TEST_TRACKS): Promise<void>;
  getRequests(eventCode: string): Promise<Array<{ id: number; status: string; title: string }>>;
  updateRequestStatus(eventCode: string, requestId: number, status: string): Promise<void>;
  dispose(): Promise<void>;
}

export async function createTestApi(playwright: { request: { newContext: (opts: { baseURL: string; ignoreHTTPSErrors: boolean }) => Promise<APIRequestContext> } }, baseURL: string): Promise<TestApi> {
  const apiOrigin = getApiOrigin(baseURL);

  const api = await playwright.request.newContext({
    baseURL: apiOrigin,
    ignoreHTTPSErrors: true,
  });

  // Authenticate
  const loginRes = await api.post('/api/auth/login', {
    form: { username: USERNAME, password: PASSWORD },
  });
  expect(loginRes.ok(), `Login failed: ${loginRes.status()}`).toBeTruthy();
  const loginData = await loginRes.json();
  const jwt = loginData.access_token;

  const authHeaders = { Authorization: `Bearer ${jwt}` };

  return {
    api,
    jwt,
    apiOrigin,

    async createEvent(name: string) {
      const res = await api.post('/api/events', {
        headers: authHeaders,
        data: { name },
      });
      expect(res.ok(), `Event creation failed: ${res.status()}`).toBeTruthy();
      return res.json();
    },

    async seedRequest(eventCode, track) {
      const res = await api.post(`/api/events/${eventCode}/requests`, {
        data: track,
      });
      expect(res.ok(), `Seed request failed: ${res.status()}`).toBeTruthy();
      return res.json();
    },

    async seedRequests(eventCode, tracks = TEST_TRACKS) {
      for (const track of tracks) {
        const res = await api.post(`/api/events/${eventCode}/requests`, { data: track });
        expect(res.ok(), `Seed request failed for "${track.title}": ${res.status()}`).toBeTruthy();
      }
    },

    async getRequests(eventCode) {
      const res = await api.get(`/api/events/${eventCode}/requests`, {
        headers: authHeaders,
      });
      expect(res.ok()).toBeTruthy();
      return res.json();
    },

    async updateRequestStatus(eventCode, requestId, status) {
      const res = await api.patch(`/api/events/${eventCode}/requests/${requestId}`, {
        headers: authHeaders,
        data: { status },
      });
      expect(res.ok(), `Status update failed: ${res.status()}`).toBeTruthy();
    },

    async dispose() {
      await api.dispose();
    },
  };
}

// ─── Auth Setup ───────────────────────────────────────────────────────────────

export function setupAuth(
  page: Page,
  jwt: string,
  options: { clearSortPrefs?: boolean } = {},
) {
  const { clearSortPrefs = true } = options;
  return page.addInitScript(
    ({ token, clear }: { token: string; clear: boolean }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('wrzdj-help-disabled', '1');
      if (clear) {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('wrzdj-sort-'))
          .forEach((k) => localStorage.removeItem(k));
      }
    },
    { token: jwt, clear: clearSortPrefs },
  );
}

// ─── Wait Helpers ─────────────────────────────────────────────────────────────

/** Wait for DOM content + a short settle period for React hydration */
export async function waitForPage(page: Page, settleMs = 800) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(settleMs);
}
