import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/priority-sort.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.SCREENSHOT_BASE_URL || 'https://192.168.20.5',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'e2e',
      use: { browserName: 'chromium' },
    },
  ],
});
