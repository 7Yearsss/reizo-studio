// Package into a new disposable directory. Never start the packaged Electron app or use userData.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reizo-package-qa-'));
console.log(JSON.stringify({ phase: 'package-start', root, timestamp: new Date().toISOString() }));
const { api } = require('@electron-forge/core');
try {
  const result = await api.package({ dir: path.resolve('.'), outDir: root, platform: 'win32', arch: 'x64', interactive: false });
  const receipt = { root, result, timestamp: new Date().toISOString() };
  await fs.writeFile(path.join(root, 'package-receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ phase: 'package-finished', ...receipt }));
} catch (error) {
  await fs.writeFile(path.join(root, 'package-failure.txt'), String(error?.stack ?? error));
  console.error(error); process.exitCode = 1;
}
