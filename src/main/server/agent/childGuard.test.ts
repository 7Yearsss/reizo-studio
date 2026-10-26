import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardChildCommand } from './childGuard';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitFor<T>(read: () => Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await read().catch((): null => null); if (value !== null) return value; await sleep(100); }
  return null;
}

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'child-guard-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('guardChildCommand', () => {
  it('rewrites the command to run under the guard with the real command after the parent pid', () => {
    const guarded = guardChildCommand({ command: 'npx', args: ['-y', 'server'], env: { TOKEN: 't' } }, { parentPid: 4242, execPath: 'C:/app/electron.exe', baseEnv: { PATH: '/bin' } });
    expect(guarded.command).toBe('C:/app/electron.exe');
    expect(guarded.args.slice(0, 1)).toEqual(['-e']);
    expect(guarded.args.slice(2)).toEqual(['4242', 'npx', '-y', 'server']);
    expect(guarded.env).toMatchObject({ PATH: '/bin', TOKEN: 't', ELECTRON_RUN_AS_NODE: '1' });
  });

  it('the guard is a single line (the MCP stdio transport rejects line breaks on Windows)', () => {
    const guarded = guardChildCommand({ command: 'x', args: [] });
    expect(guarded.args.every((arg) => !/[\r\n]/.test(arg))).toBe(true);
  });

  it('passes the child exit code through', async () => {
    const guarded = guardChildCommand({ command: process.execPath, args: ['-e', 'process.exit(7)'] }, { baseEnv: process.env });
    const code = await new Promise<number | null>((resolve) => spawn(guarded.command, guarded.args, { env: guarded.env, stdio: 'ignore', windowsHide: true }).on('exit', resolve));
    expect(code).toBe(7);
  });

  it('kills the whole child when the parent is force-killed (no orphan)', async () => {
    const pidFile = path.join(tmp, 'child.pid');
    // A stand-in for Reizo: a long-lived process we then kill without any chance to clean up.
    const childSource = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    await sleep(200);
    const guarded = guardChildCommand({ command: process.execPath, args: ['-e', childSource] }, { parentPid: parent.pid!, baseEnv: process.env });
    const guard = spawn(guarded.command, guarded.args, { env: guarded.env, stdio: 'ignore', windowsHide: true });
    const childPid = Number(await waitFor(async () => (await readFile(pidFile, 'utf8')) || null, 15_000));
    expect(childPid).toBeGreaterThan(0);
    expect(alive(childPid)).toBe(true);

    parent.kill('SIGKILL'); // the "crash"
    const died = await waitFor(async () => (alive(childPid) ? null : true), 15_000);
    expect(died).toBe(true);
    expect(alive(guard.pid!)).toBe(false);
  }, 40_000);
});
