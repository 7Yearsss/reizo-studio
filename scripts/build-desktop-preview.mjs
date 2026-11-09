// A stable local desktop snapshot: no renderer development server at runtime.
import { build, loadConfigFromFile } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const appRoot = path.join(root, '.cache/desktop-preview/app');
await mkdir(appRoot, { recursive: true });
for (const [target, entry] of [['main', 'src/main/index.ts'], ['preload', 'src/preload/preload.ts']]) {
  const { getConfig } = require(`@electron-forge/plugin-vite/dist/config/vite.${target}.config.js`);
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, `vite.${target}.config.ts`);
  const config = getConfig({ root, command: 'build', mode: 'production', forgeConfigSelf: { entry }, forgeConfig: { renderer: [{ name: 'main_window' }] } }, loaded.config);
  config.build.outDir = path.join(appRoot, 'build');
  config.build.emptyOutDir = target === 'main';
  if (target === 'main') config.define.MAIN_WINDOW_VITE_DEV_SERVER_URL = 'undefined';
  await build(config);
}
const renderer = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'vite.renderer.config.mts');
await build({ ...renderer.config, configFile: false, root, base: './', build: { ...renderer.config.build, outDir: path.join(appRoot, 'renderer/main_window'), emptyOutDir: true } });
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: manifest.name, productName: manifest.productName, version: manifest.version, main: 'build/index.js' }));
console.log('Desktop snapshot ready. Run npm run desktop:open.');
