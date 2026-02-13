import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', '.next', '**/*.test.{ts,tsx}', 'vitest.config.ts', 'vitest.setup.ts'],
      thresholds: {
        branches: 40,
        functions: 40,
        lines: 55,
        statements: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
