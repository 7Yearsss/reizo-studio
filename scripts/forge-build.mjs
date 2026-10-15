import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { patchForgeWindows, prepareSquirrelTools } from './patch-forge-windows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
if (!['package', 'make'].includes(command)) throw new Error('Expected package or make');
patchForgeWindows();
if (command === 'make') prepareSquirrelTools();
// Forge starts another Node process, so propagate the heap limit through its env.
// Preserve an explicit user limit rather than silently overriding it.
const options = process.env.NODE_OPTIONS || '';
// Use the system temp volume: directory renames can fail with EPERM on a
// workspace volume even when file writes succeed. Keep the suffix short for
// Squirrel's legacy MAX_PATH limit. REIZO_BUILD_TEMP remains an explicit override.
const buildTemp = path.resolve(process.env.REIZO_BUILD_TEMP || path.join(tmpdir(), 'reizo-build'));
mkdirSync(buildTemp, { recursive: true });
const env = { ...process.env, TEMP: buildTemp, TMP: buildTemp, SQUIRREL_TEMP: process.env.SQUIRREL_TEMP || buildTemp, NODE_OPTIONS: /--max[-_]old[-_]space[-_]size(?:=|\s)/.test(options)
  ? options : `${options} --max-old-space-size=8192`.trim() };
const child = spawn(process.execPath, [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), command, ...args], {
  cwd: root, env, stdio: 'inherit', windowsHide: true,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
