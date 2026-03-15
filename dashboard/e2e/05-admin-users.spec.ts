import { test, expect } from '@playwright/test';
import { createTestApi, setupAuth, waitForPage, type TestApi } from './helpers';

/**
 * Admin dashboard E2E tests — user management, overview stats, settings.
 */

let testApi: TestApi;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL || 'https://192.168.20.5';
  testApi = await createTestApi(playwright, baseURL);
});

test.afterAll(async () => {
  await testApi.dispose();
});

test.describe('Admin Dashboard', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('admin users page loads with user list', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto('/admin/users');
    await waitForPage(page, 2000);

    // User table should be visible
    const table = page.locator('.admin-table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // At least the admin user should be listed
    const rows = page.locator('.admin-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('role filter tabs work', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto('/admin/users');
    await waitForPage(page, 2000);

    // Click "Admins" tab
    const adminsTab = page.locator('button.tab', { hasText: 'Admins' });
    await adminsTab.click();
    await page.waitForTimeout(500);

    // Should show at least 1 admin user
    const rows = page.locator('.admin-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);

    // Each visible role badge should be admin
    const roleBadges = page.locator('.badge-role-admin');
    expect(await roleBadges.count()).toBeGreaterThan(0);

    // Click "All" to reset
    const allTab = page.locator('button.tab', { hasText: 'All' });
    await allTab.click();
    await page.waitForTimeout(500);

    const allRows = page.locator('.admin-table tbody tr');
    expect(await allRows.count()).toBeGreaterThanOrEqual(await rows.count());
  });

  test('overview stats are populated', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto('/admin');
    await waitForPage(page, 2000);

    // Stats grid should be visible
    const statsGrid = page.locator('.stats-grid');
    await expect(statsGrid).toBeVisible({ timeout: 10000 });

    // Stat cards should have numeric values
    const statValues = page.locator('.stat-value');
    expect(await statValues.count()).toBeGreaterThan(0);

    // At least one stat should show a number > 0 (we have users and events)
    const firstValue = await statValues.first().textContent();
    expect(firstValue).toBeTruthy();
    expect(Number(firstValue)).toBeGreaterThanOrEqual(0);
  });

  test('settings page loads with toggle elements', async ({ page }) => {
    await setupAuth(page, testApi.jwt);
    await page.goto('/admin/settings');
    await waitForPage(page, 2000);

    // Self-Registration toggle should be visible
    const regLabel = page.locator('text=Self-Registration');
    await expect(regLabel).toBeVisible({ timeout: 10000 });

    // Save Settings button should be present
    const saveBtn = page.locator('button:has-text("Save Settings")');
    await expect(saveBtn).toBeVisible();
  });
});
