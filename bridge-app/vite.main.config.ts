import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

// Modules that must be externalized from the Vite bundle (loaded via require()
// at runtime). Bundling stagelinq breaks TCP connection state management and
// class name-dependent service resolution.
const externalDeps = ['stagelinq'];

/**
 * Copies externalized dependencies into the build output's node_modules/ so
 * they're available at runtime in the packaged app. Required because
 * @electron-forge/plugin-vite excludes the project's node_modules/ from the
 * asar (it assumes Vite bundles everything).
 */
function copyExternals(deps: string[]): Plugin {
  return {
    name: 'copy-externals',
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) return;
      for (const dep of deps) {
        const src = path.resolve(__dirname, 'node_modules', dep);
        const dest = path.join(outDir, 'node_modules', dep);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true, force: true });
        }
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@bridge': path.resolve(__dirname, '../bridge/src'),
    },
  },
  plugins: [copyExternals(externalDeps)],
  build: {
    rollupOptions: {
      external: externalDeps,
    },
  },
});
