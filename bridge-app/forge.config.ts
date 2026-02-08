import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerAppImage } from '@reforged/maker-appimage';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'WrzDJ Bridge',
    executableName: 'wrzdj-bridge',
    icon: './resources/icon',
    asar: true,
    appBundleId: 'com.wrzdj.bridge',
  },
  makers: [
    new MakerSquirrel({
      name: 'wrzdj-bridge',
      authors: 'WrzDJ',
      setupIcon: './resources/icon.ico',
    }),
    new MakerDMG({
      icon: './resources/icon.icns',
    }),
    new MakerAppImage({
      options: {
        name: 'wrzdj-bridge',
        bin: 'wrzdj-bridge',
        icon: './resources/icon.png',
        categories: ['Audio'],
      },
    }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
