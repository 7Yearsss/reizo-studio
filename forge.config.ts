import type { ForgeConfig } from '@electron-forge/shared-types';
import { OfflineSquirrelMaker } from './scripts/offline-squirrel-maker';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const config: ForgeConfig = {
  hooks: {
    generateAssets: async (_config, platform, arch) => {
      execFileSync(process.execPath, ['scripts/prepare-voice-runtime.mjs'], { stdio: 'inherit', windowsHide: true });
      const resources = _config.packagerConfig?.extraResource;
      const extraResource = [...(Array.isArray(resources) ? resources : resources ? [resources] : []), path.resolve('.cache/voice-runtime')];
      _config.packagerConfig = { ..._config.packagerConfig, extraResource };
      // The bundled editor runtime is Windows x64 only; other targets ship without the video editor panel.
      if (platform !== 'win32' || arch !== 'x64') return;
      const editorManifest = path.resolve('.cache/openchatcut-runtime.json');
      if (!existsSync(editorManifest)) {
        console.warn('[forge] Skipping video editor resources (.cache/openchatcut-runtime.json missing). Run npm run setup:video-editor to enable the editor.');
        return;
      }
      execFileSync(process.execPath, ['scripts/build-openchatcut-runtime.mjs'], { stdio: 'inherit', windowsHide: true });
      const packaged = JSON.parse(readFileSync('.cache/openchatcut-package.json', 'utf8')) as { directory: string };
      const relative = path.relative(path.resolve('.cache/package-resources'), packaged.directory);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(packaged.directory) !== 'video-editor') throw new Error('Invalid packaged editor resource path');
      _config.packagerConfig = { ..._config.packagerConfig, extraResource: [...extraResource, packaged.directory] };
    },
  },
  packagerConfig: {
    asar: true,
    icon: 'resources/icon',
    // Only runtime build output belongs in app.asar; keep private QA fixtures out.
    ignore: (file) => Boolean(file) && file !== '/.vite' && !/^\/\.vite\/(build|renderer)(?:\/|$)/.test(file),
    executableName: 'reizo-studio',
    extendInfo: { NSMicrophoneUsageDescription: '将你的语音在本机转为对话草稿。' },
    // Re-sign the entire bundle after Packager changes Info.plist and Electron
    // fuses. Ad-hoc signing restores integrity; it is not Developer ID signing
    // or notarization and does not enable trusted macOS automatic updates.
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      // osx-sign defaults to hardened runtime, whose library validation rejects
      // the ad-hoc Electron Framework at launch ("different Team IDs"). Without
      // a Developer ID there is no shared Team ID, so leave it off.
      optionsForFile: () => ({ timestamp: 'none', hardenedRuntime: false }),
    },
    // WASM binaries for the local matting feature (onnxruntime-web): copied
    // flat into resources/ so /api/matting/ort/* can serve them in packaged
    // builds. The asyncify variants are intentionally left out (~25MB) — the
    // u2netp graph doesn't need them.
      extraResource: [
        './skills',
        './third_party',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
    ],
  },
  rebuildConfig: {},
  makers: [
    new OfflineSquirrelMaker({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { icon: 'resources/icon.png' } }),
    new MakerDeb({ options: { icon: 'resources/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      // The editor and document workspaces are large; avoid overlapping bundle heaps.
      concurrent: 1,
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
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
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
