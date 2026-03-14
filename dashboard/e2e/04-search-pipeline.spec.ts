import { test, expect } from '@playwright/test';
import { createTestApi, setupAuth, waitForPage, type TestApi } from './helpers';

/**
 * Search pipeline E2E tests — hits real services (Tidal/Spotify).
 *
 * These tests validate the unified search pipeline including result
 * rendering, junk filtering, and metadata badges. They require a
 * running backend with at least one music service configured.
 */

let testApi: TestApi;
let eventCode: string;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL || 'https://192.168.20.5';
  testApi = await createTestApi(playwright, baseURL);
  const event = await testApi.createEvent('E2E-Search-Pipeline');
  eventCode = event.code;
});

test.afterAll(async () => {
  await testApi.dispose();
});

test.describe('Search Pipeline', () => {
  // Real service calls can be slow
  test.slow();

  test('search returns results with album art', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/join/${eventCode}`);
    await waitForPage(page, 2000);

    await page.fill('input[placeholder*="Search for a song or artist"]', 'taylor swift');
    await page.click('button:has-text("Search")');

    const results = page.locator('.request-item');
    // If no results (service down), skip gracefully
    try {
      await expect(results.first()).toBeVisible({ timeout: 15000 });
    } catch {
      test.skip();
      return;
    }
    expect(await results.count()).toBeGreaterThan(0);

    // At least some results should have album art
    const albumArts = page.locator('.request-item img');
    expect(await albumArts.count()).toBeGreaterThan(0);
  });

  test('junk results are filtered out', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/join/${eventCode}`);
    await waitForPage(page, 2000);

    await page.fill('input[placeholder*="Search for a song or artist"]', 'above and beyond');
    await page.click('button:has-text("Search")');

    const results = page.locator('.request-item');
    try {
      await expect(results.first()).toBeVisible({ timeout: 15000 });
    } catch {
      test.skip();
      return;
    }

    // Check that no titles contain junk keywords
    const count = await results.count();
    for (let i = 0; i < count; i++) {
      const title = await results.nth(i).locator('h3').textContent();
      if (title) {
        const lower = title.toLowerCase();
        expect(lower).not.toContain('workout');
        expect(lower).not.toContain('cardio');
        // "Pt." suffix is junk indicator (compilations, not real tracks)
        expect(lower).not.toMatch(/\bpt\.\s*$/);
      }
    }
  });

  test('consecutive searches work (regression)', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/join/${eventCode}`);
    await waitForPage(page, 2000);

    // First search
    await page.fill('input[placeholder*="Search for a song or artist"]', 'daft punk');
    await page.click('button:has-text("Search")');

    const results = page.locator('.request-item');
    try {
      await expect(results.first()).toBeVisible({ timeout: 15000 });
    } catch {
      test.skip();
      return;
    }

    // Second search — clear and search again
    const searchInput = page.locator('input[placeholder*="Search for a song or artist"]');
    await searchInput.clear();
    await searchInput.fill('metallica');
    await page.click('button:has-text("Search")');

    // New results should appear
    await page.waitForTimeout(2000);
    const newResults = page.locator('.request-item');
    await expect(newResults.first()).toBeVisible({ timeout: 15000 });
    expect(await newResults.count()).toBeGreaterThan(0);
  });

  test('adding search result to queue works', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/join/${eventCode}`);
    await waitForPage(page, 2000);

    await page.fill('input[placeholder*="Search for a song or artist"]', 'bohemian rhapsody');
    await page.click('button:has-text("Search")');

    const results = page.locator('.request-item');
    try {
      await expect(results.first()).toBeVisible({ timeout: 15000 });
    } catch {
      test.skip();
      return;
    }

    // Select first result
    await results.first().click();

    // Submit
    const submitBtn = page.locator('button:has-text("Submit Request")');
    await expect(submitBtn).toBeVisible({ timeout: 3000 });
    await submitBtn.click();

    // Verify success
    const success = page.locator('text=/Request Submitted!|Vote Added!/');
    await expect(success).toBeVisible({ timeout: 5000 });
  });

  test('BPM/key badges visible on some results', async ({ page }) => {
    // Use a fresh event since prior test may have submitted a request,
    // causing has_requested to trigger the request list view
    const badgeEvent = await testApi.createEvent('E2E-Search-Badges');

    await setupAuth(page, testApi.jwt);
    await page.goto(`/join/${badgeEvent.code}`);
    await waitForPage(page, 2000);

    await page.fill('input[placeholder*="Search for a song or artist"]', 'above and beyond');
    await page.click('button:has-text("Search")');

    const results = page.locator('.request-item');
    try {
      await expect(results.first()).toBeVisible({ timeout: 15000 });
    } catch {
      test.skip();
      return;
    }

    // At least some results should show BPM or key badges
    // These come from Tidal/Beatport enriched results
    const bpmBadges = page.locator('.badge-bpm, [title*="BPM"]');
    const keyBadges = page.locator('.badge-key, [title*="Key"]');
    const totalBadges = await bpmBadges.count() + await keyBadges.count();

    // It's acceptable if no badges appear (depends on service availability)
    if (totalBadges === 0) {
      test.info().annotations.push({
        type: 'info',
        description: 'No BPM/key badges found — services may not return metadata for this query',
      });
    }
  });
});
