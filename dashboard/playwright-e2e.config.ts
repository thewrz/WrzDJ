import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // exploratory-pb5ttp.spec.ts is a local-only sweep tool — hardcoded to a
  // specific event code and creates real test events on the live API. Not
  // suitable for CI; opt-in via `npx playwright test --grep ...` locally.
  testIgnore: ['**/screenshots.spec.ts', '**/exploratory-pb5ttp.spec.ts'],
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
