import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bridge': path.resolve(__dirname, '../bridge/src'),
    },
  },
  build: {
    rollupOptions: {
      // Externalize the stagelinq library so it's loaded via require() at
      // runtime instead of being bundled by Vite. The CLI bridge loads it
      // this way and it works correctly; bundling it breaks TCP connection
      // state management and native module resolution (better-sqlite3).
      external: ['stagelinq'],
    },
  },
});
