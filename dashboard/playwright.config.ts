import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/screenshots.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.SCREENSHOT_BASE_URL || 'https://app.local',
    ignoreHTTPSErrors: true,
    screenshot: 'off',
  },
  projects: [
    {
      name: 'screenshots',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
