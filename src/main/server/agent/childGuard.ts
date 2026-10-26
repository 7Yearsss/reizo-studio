/**
 * Child processes (MCP servers…) must not outlive the app. A normal quit cleans them up, but a crash or a
 * force-kill of Reizo skips that and leaves them running. So each one is started through a tiny guard process:
 * it runs the real command, watches whether Reizo is still alive, and takes the whole child tree down with it
 * the moment Reizo is gone. The guard is inline code run by the same runtime (no extra file to package).
 */
// One line: the MCP stdio transport rejects arguments containing line breaks on Windows.
const GUARD_SOURCE = `
const { spawn, spawnSync } = require('node:child_process');
const parentPid = Number(process.argv[1]);
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit', env: process.env, windowsHide: true });
function killTree() {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {}
}
function parentAlive() {
  try { process.kill(parentPid, 0); return true; } catch (error) { return error && error.code === 'EPERM'; }
}
const timer = setInterval(() => { if (!parentAlive()) { killTree(); process.exit(1); } }, 1000);
child.on('error', (error) => { console.error(String(error && error.message || error)); process.exit(127); });
child.on('exit', (code, signal) => { clearInterval(timer); process.exit(code === null ? (signal ? 1 : 0) : code); });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { killTree(); process.exit(1); });
`
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join(' ');

export interface GuardedSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Rewrite `command args…` so it runs under the guard. `execPath` is the runtime that runs the guard — in the
 * packaged app that is Electron itself, which acts as plain Node when ELECTRON_RUN_AS_NODE is set.
 */
export function guardChildCommand(
  spec: { command: string; args: string[]; env?: Record<string, string> },
  options: { parentPid?: number; execPath?: string; baseEnv?: Record<string, string | undefined> } = {},
): GuardedSpawn {
  const base: Record<string, string> = {};
  // Start from nothing by default: the MCP transport supplies its own safe environment, and the app's full environment (which can hold keys) must not leak into servers.
  for (const [key, value] of Object.entries(options.baseEnv ?? {})) if (typeof value === 'string') base[key] = value;
  return {
    command: options.execPath ?? process.execPath,
    args: ['-e', GUARD_SOURCE, String(options.parentPid ?? process.pid), spec.command, ...spec.args],
    env: { ...base, ...(spec.env ?? {}), ELECTRON_RUN_AS_NODE: '1' },
  };
}
