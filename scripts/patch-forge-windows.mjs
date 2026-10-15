import { createRequire } from 'node:module';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Forge 7.11.2 supplies a native Windows path to fast-glob's POSIX pattern API. */
export function patchForgeWindows() {
  if (process.platform !== 'win32') return;
  const require = createRequire(import.meta.url);
  const manifest = require.resolve('@electron-forge/core/package.json');
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (version !== '7.11.2') throw new Error(`Review the Forge Windows glob compatibility patch for version ${version}`);
  const file = path.join(path.dirname(manifest), 'dist/api/package.js');
  const source = readFileSync(file, 'utf8');
  const marker = '/* Reizo: scope Windows bin cleanup to the packaged app */';
  if (source.includes(marker)) return;
  const before = "const bins = await (0, fast_glob_1.default)(node_path_1.default.join(buildPath, '**/.bin/**/*'));";
  const after = `${marker}\n                        const bins = await (0, fast_glob_1.default)('**/.bin/**/*', { cwd: buildPath, absolute: true });`;
  if (source.split(before).length !== 2) throw new Error('Forge Windows glob patch target changed');
  writeFileSync(file, source.replace(before, after));
}

/** Squirrel's bundled x86 rcedit cannot commit this large offline installer. */
export function prepareSquirrelTools() {
  if (process.platform !== 'win32') return;
  if (process.arch !== 'x64') throw new Error('The offline Windows installer currently requires an x64 build host');
  const require = createRequire(import.meta.url);
  const installerRoot = path.dirname(require.resolve('electron-winstaller/package.json'));
  const editorRoot = path.resolve(path.dirname(require.resolve('rcedit')), '..');
  if (JSON.parse(readFileSync(path.join(installerRoot, 'package.json'), 'utf8')).version !== '5.4.4'
    || JSON.parse(readFileSync(path.join(editorRoot, 'package.json'), 'utf8')).version !== '5.0.2') {
    throw new Error('Review the pinned Squirrel resource-editor compatibility fix after a dependency upgrade');
  }
  const vendor = path.join(installerRoot, 'vendor');
  for (const [source, destination] of [
    [path.join(editorRoot, 'bin/rcedit-x64.exe'), path.join(vendor, 'rcedit.exe')],
    [path.join(vendor, '7z-x64.exe'), path.join(vendor, '7z.exe')],
    [path.join(vendor, '7z-x64.dll'), path.join(vendor, '7z.dll')],
  ]) {
    const expected = readFileSync(source);
    if (!existsSync(destination) || !readFileSync(destination).equals(expected)) copyFileSync(source, destination);
  }
}
