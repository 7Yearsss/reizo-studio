import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const appRoot = path.join(root, '.cache/desktop-preview/app');
if (!existsSync(path.join(appRoot, 'build/index.js')) || !existsSync(path.join(appRoot, 'renderer/main_window/index.html'))) {
  console.error('Build the desktop snapshot first: npm run desktop:build');
  process.exit(1);
}
mkdirSync(path.join(root, '.cache/desktop-preview'), { recursive: true });
const out = openSync(path.join(root, '.cache/desktop-preview/stdout.log'), 'a');
const err = openSync(path.join(root, '.cache/desktop-preview/stderr.log'), 'a');
writeSync(out, `\n[startup] launch ${new Date().toISOString()}\n`);
const child = spawn(require('electron'), [appRoot, ...(process.platform === 'win32' ? ['--disable-gpu'] : [])], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.unref(); closeSync(out); closeSync(err);
