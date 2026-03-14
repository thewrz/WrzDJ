import { test, expect } from '@playwright/test';
import { createTestApi, setupAuth, waitForPage, TEST_TRACKS, type TestApi } from './helpers';

/**
 * DJ event management — request lifecycle, bulk actions, and filter tabs.
 */

let testApi: TestApi;
let eventCode: string;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL || 'https://192.168.20.5';
  testApi = await createTestApi(playwright, baseURL);
  const event = await testApi.createEvent('E2E-DJ-Mgmt-Test');
  eventCode = event.code;
  await testApi.seedRequests(eventCode);
});

test.afterAll(async () => {
  await testApi.dispose();
});

test.describe('DJ Event Management', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('event page shows request list with correct count', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${eventCode}`);
    await waitForPage(page, 2000);

    // The "All" tab should show the total count
    const allTab = page.locator('button.tab', { hasText: 'All' });
    await expect(allTab).toBeVisible();
    const tabText = await allTab.textContent();
    expect(tabText).toContain(`${TEST_TRACKS.length}`);

    // Request items should be listed
    const items = page.locator('.request-item');
    expect(await items.count()).toBe(TEST_TRACKS.length);
  });

  test('accept request changes status badge', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${eventCode}`);
    await waitForPage(page, 2000);

    // Find a request item with a "new" badge and click Accept
    const firstNew = page.locator('.request-item').filter({ has: page.locator('.badge-new') }).first();
    await expect(firstNew).toBeVisible();
    await firstNew.locator('button:has-text("Accept")').click();

    // Wait for the status to update
    await page.waitForTimeout(1000);

    // The accepted badge should now appear on that item
    const acceptedBadge = firstNew.locator('.badge-accepted');
    await expect(acceptedBadge).toBeVisible({ timeout: 5000 });
  });

  test('reject request changes status badge', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${eventCode}`);
    await waitForPage(page, 2000);

    // Find a "new" request and reject it
    const newItem = page.locator('.request-item').filter({ has: page.locator('.badge-new') }).first();
    await expect(newItem).toBeVisible();
    await newItem.locator('button:has-text("Reject")').click();

    await page.waitForTimeout(1000);

    const rejectedBadge = newItem.locator('.badge-rejected');
    await expect(rejectedBadge).toBeVisible({ timeout: 5000 });
  });

  test('Mark Playing transitions request to playing state', async ({ page }) => {
    // Use a fresh event with a pre-accepted request for deterministic state
    const playingEvent = await testApi.createEvent('E2E-DJ-MarkPlaying');
    await testApi.seedRequests(playingEvent.code);
    const requests = await testApi.getRequests(playingEvent.code);
    await testApi.updateRequestStatus(playingEvent.code, requests[0].id, 'accepted');

    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${playingEvent.code}`);
    await waitForPage(page, 2000);

    // Find the accepted request and click Mark Playing
    const acceptedItem = page.locator('.request-item').filter({ has: page.locator('.badge-accepted') }).first();
    await expect(acceptedItem).toBeVisible({ timeout: 5000 });
    await acceptedItem.locator('button:has-text("Mark Playing")').click();

    const playingBadge = acceptedItem.locator('.badge-playing');
    await expect(playingBadge).toBeVisible({ timeout: 5000 });
  });

  test('Accept All bulk action accepts remaining new requests', async ({ page }) => {
    // Create a fresh event for this test to ensure we have new requests
    const freshEvent = await testApi.createEvent('E2E-DJ-AcceptAll');
    await testApi.seedRequests(freshEvent.code);

    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${freshEvent.code}`);
    await waitForPage(page, 2000);

    // Click "Accept All" button
    const acceptAllBtn = page.locator('button:has-text("Accept All")');
    await expect(acceptAllBtn).toBeVisible();
    await acceptAllBtn.click();

    // Wait for all requests to be accepted
    await page.waitForTimeout(2000);

    // The "New" tab count should now be 0
    const newTab = page.locator('button.tab', { hasText: 'New' });
    const newTabText = await newTab.textContent();
    expect(newTabText).toContain('0');
  });

  test('filter tabs show correct filtered results', async ({ page }) => {
    // Create event with requests in different states
    const filterEvent = await testApi.createEvent('E2E-DJ-Filters');
    await testApi.seedRequests(filterEvent.code);

    // Accept 2 requests via API
    const requests = await testApi.getRequests(filterEvent.code);
    await testApi.updateRequestStatus(filterEvent.code, requests[0].id, 'accepted');
    await testApi.updateRequestStatus(filterEvent.code, requests[1].id, 'accepted');

    await setupAuth(page, testApi.jwt);
    await page.goto(`/events/${filterEvent.code}`);
    await waitForPage(page, 2000);

    // "Accepted" tab should show 2
    const acceptedTab = page.locator('button.tab', { hasText: 'Accepted' });
    await acceptedTab.click();
    await page.waitForTimeout(500);

    const acceptedItems = page.locator('.request-item');
    expect(await acceptedItems.count()).toBe(2);

    // "New" tab should show remaining 2
    const newTab = page.locator('button.tab', { hasText: 'New' });
    await newTab.click();
    await page.waitForTimeout(500);

    const newItems = page.locator('.request-item');
    expect(await newItems.count()).toBe(2);
  });
});
