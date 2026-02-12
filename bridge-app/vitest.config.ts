import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bridge': path.resolve(__dirname, '../bridge/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', 'dist', '**/*.test.{ts,tsx}', 'vitest.config.ts'],
      thresholds: {
        branches: 55,
        functions: 70,
        lines: 75,
        statements: 75,
      },
    },
  },
});
