import path from 'path';
import { test, expect } from '@playwright/test';

const USERNAME = process.env.SCREENSHOT_USERNAME || 'admin';
const PASSWORD = process.env.SCREENSHOT_PASSWORD || 'admin123';
const API_PORT = process.env.SCREENSHOT_API_PORT || '8443';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/images');

let jwt = '';
let eventCode = '';

test.beforeAll(async ({ playwright }, testInfo) => {
  const base = testInfo.project.use.baseURL || 'https://app.local';
  const apiUrl = new URL(base);
  apiUrl.port = API_PORT;

  const api = await playwright.request.newContext({
    baseURL: apiUrl.origin,
    ignoreHTTPSErrors: true,
  });

  // Authenticate
  const loginRes = await api.post('/api/auth/login', {
    form: {
      username: USERNAME,
      password: PASSWORD,
    },
  });
  expect(loginRes.ok(), `Login failed: ${loginRes.status()}`).toBeTruthy();
  const loginData = await loginRes.json();
  jwt = loginData.access_token;

  // Use the pre-seeded "demo" event (server/scripts/seed_demo_event.py) so screenshots
  // show realistic data: 4 enriched requests (BPM/key/genre) + 1 upvoted by a guest.
  // Falls back to creating a fresh event if the seed hasn't been run.
  const seedRes = await api.get('/api/events/DEMO01', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (seedRes.ok()) {
    eventCode = 'DEMO01';
  } else {
    const createRes = await api.post('/api/events', {
      headers: { Authorization: `Bearer ${jwt}` },
      data: { name: 'demo' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    eventCode = created.code;
  }

  await api.dispose();
});

async function setupAuth(page: import('@playwright/test').Page) {
  if (!jwt) throw new Error('beforeAll did not run or login failed — jwt is empty');
  await page.addInitScript((token: string) => {
    localStorage.setItem('token', token);
    // Suppress help/onboarding for clean screenshots
    localStorage.setItem('wrzdj-help-disabled', '1');
  }, jwt);
}

async function ensureCleanUI(page: import('@playwright/test').Page) {
  // Dismiss any active overlay (safety net)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

async function waitForPage(page: import('@playwright/test').Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
}

async function capture(
  page: import('@playwright/test').Page,
  name: string,
  opts: { fullPage?: boolean } = {},
) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: opts.fullPage ?? true,
  });
}

// --- Authenticated pages (1440x900 desktop) ---

test.describe('Authenticated pages', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('DJ Dashboard', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/dashboard');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'dj-dashboard');
  });

  test('Events List', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/events');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'events-list');
  });

  test('Event Management — Song Tab', async ({ page }) => {
    await setupAuth(page);
    await page.goto(`/events/${eventCode}`);
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'event-management');
  });

  test('Event Management — Manage Tab', async ({ page }) => {
    await setupAuth(page);
    await page.goto(`/events/${eventCode}`);
    await waitForPage(page);
    await ensureCleanUI(page);
    await page.click('.event-tab:has-text("Event Management")');
    await page.waitForTimeout(500);
    await capture(page, 'event-management-tab');
  });

  test('Admin Overview', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/admin');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'admin-overview');
  });

  test('Admin Users', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/admin/users');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'admin-users');
  });

  test('Admin Integrations', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/admin/integrations');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'admin-integrations');
  });

  test('Admin Settings', async ({ page }) => {
    await setupAuth(page);
    await page.goto('/admin/settings');
    await waitForPage(page);
    await ensureCleanUI(page);
    await capture(page, 'admin-settings');
  });
});

// --- Public pages ---

test.describe('Public pages', () => {
  test('Guest Join (mobile)', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 844 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${eventCode}`);
    await waitForPage(page);
    await capture(page, 'guest-join-mobile');
    await ctx.close();
  });

  test('Guest Collect (mobile)', async ({ browser, playwright }, testInfo) => {
    // Force the event into collection phase so /collect renders the Tower v2 UI.
    const base = testInfo.project.use.baseURL || 'https://app.local';
    const apiUrl = new URL(base);
    apiUrl.port = API_PORT;
    const api = await playwright.request.newContext({
      baseURL: apiUrl.origin,
      ignoreHTTPSErrors: true,
    });
    await api.patch(`/api/events/${eventCode}/collection`, {
      headers: { Authorization: `Bearer ${jwt}` },
      data: { collection_phase_override: 'force_collection' },
    });
    await api.dispose();

    const ctx = await browser.newContext({
      viewport: { width: 430, height: 844 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(`/collect/${eventCode}`);
    await waitForPage(page);
    await capture(page, 'guest-collect-mobile');
    await ctx.close();
  });

  test('Kiosk Display', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(`/e/${eventCode}/display`);
    await waitForPage(page);
    await capture(page, 'kiosk-display', { fullPage: false });
    await ctx.close();
  });
});
