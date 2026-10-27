import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import { plainTextTerminalEnv, stripTerminalControlSequences } from '../shared/terminalOutput';
import { guardChildCommand } from './server/agent/childGuard';
import { egressEnv } from './egressControl';
import { currentProxyEnv } from './proxy';

/**
 * Long-running commands the agent starts and then keeps working around (a dev server, a watcher, a long build).
 * Output is kept in a bounded buffer and read incrementally by offset, so a chatty process can never grow memory
 * without limit and the agent only ever sees what it has not seen yet. Every process runs under the parent-watching
 * guard, so a crash of the app does not leave it behind; a normal quit stops them all.
 */

const MAX_BUFFER_CHARS = 200_000;
const MAX_PER_SESSION = 5;
const MAX_FINISHED_KEPT = 20;

interface Shell {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  child: ChildProcess;
  /** Characters dropped off the front of `buffer`; the absolute offset of buffer[0]. */
  dropped: number;
  buffer: string;
}

const shells = new Map<string, Shell>();

export interface BackgroundShellInfo {
  id: string;
  command: string;
  running: boolean;
  exitCode?: number | null;
  startedAt: number;
  endedAt?: number;
}

function toInfo(shell: Shell): BackgroundShellInfo {
  return { id: shell.id, command: shell.command, running: shell.endedAt === undefined, exitCode: shell.exitCode, startedAt: shell.startedAt, endedAt: shell.endedAt };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function pruneFinished(): void {
  const done = [...shells.values()].filter((s) => s.endedAt !== undefined).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  for (const old of done.slice(0, Math.max(0, done.length - MAX_FINISHED_KEPT))) shells.delete(old.id);
}

export function startBackgroundShell(options: { sessionId: string; cwd: string; command: string }): BackgroundShellInfo {
  const command = options.command.trim();
  if (!command) throw new Error('command is required');
  const running = [...shells.values()].filter((s) => s.sessionId === options.sessionId && s.endedAt === undefined);
  if (running.length >= MAX_PER_SESSION) throw new Error(`同时最多运行 ${MAX_PER_SESSION} 个后台命令，请先用 stop_background 停掉不用的`);

  const guarded = guardChildCommand(
    { command, args: [], shell: true },
    { baseEnv: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, LANG: process.env.LANG, PATHEXT: process.env.PATHEXT, COMSPEC: process.env.COMSPEC, SystemRoot: process.env.SystemRoot, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', ...plainTextTerminalEnv(), ...currentProxyEnv(), ...egressEnv() } },
  );
  const child = spawn(guarded.command, guarded.args, { cwd: options.cwd, env: guarded.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const shell: Shell = { id: `bg-${nanoid(6)}`, sessionId: options.sessionId, command, cwd: options.cwd, startedAt: Date.now(), child, dropped: 0, buffer: '' };
  shells.set(shell.id, shell);

  const append = (chunk: Buffer) => {
    shell.buffer += stripTerminalControlSequences(chunk.toString('utf8'));
    if (shell.buffer.length > MAX_BUFFER_CHARS) {
      const cut = shell.buffer.length - MAX_BUFFER_CHARS;
      shell.buffer = shell.buffer.slice(cut);
      shell.dropped += cut;
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error) => { append(Buffer.from(`\n[启动失败] ${error.message}\n`)); shell.endedAt = Date.now(); shell.exitCode = 127; });
  child.on('exit', (code) => { shell.endedAt ??= Date.now(); shell.exitCode = code; pruneFinished(); });
  return toInfo(shell);
}

export interface BackgroundRead { output: string; nextOffset: number; truncatedBefore: boolean; running: boolean; exitCode?: number | null }

/** Output since `since` (an offset from a previous read; 0 for everything still buffered). */
export function readBackgroundShell(id: string, sessionId: string, since = 0): BackgroundRead | null {
  const shell = shells.get(id);
  if (!shell || shell.sessionId !== sessionId) return null;
  const total = shell.dropped + shell.buffer.length;
  const start = Math.max(since, shell.dropped);
  return {
    output: shell.buffer.slice(start - shell.dropped),
    nextOffset: total,
    truncatedBefore: since < shell.dropped,
    running: shell.endedAt === undefined,
    exitCode: shell.exitCode,
  };
}

export function stopBackgroundShell(id: string, sessionId: string): boolean {
  const shell = shells.get(id);
  if (!shell || shell.sessionId !== sessionId) return false;
  if (shell.endedAt === undefined) killTree(shell.child);
  return true;
}

export function listBackgroundShells(sessionId: string): BackgroundShellInfo[] {
  return [...shells.values()].filter((s) => s.sessionId === sessionId).map(toInfo);
}

export function runningBackgroundCount(): number {
  return [...shells.values()].filter((s) => s.endedAt === undefined).length;
}

/** Stop everything a session started (or everything, at quit). */
export function stopAllBackgroundShells(sessionId?: string): void {
  for (const shell of shells.values()) if ((!sessionId || shell.sessionId === sessionId) && shell.endedAt === undefined) killTree(shell.child);
}
