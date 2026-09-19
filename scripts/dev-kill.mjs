// Pre-start cleanup for `npm start`: kill stale listeners on the renderer
// (46173) and API (47100) dev ports left behind by a crashed or force-quit
// previous run, plus this repo's own orphaned electron-forge/electron
// processes. Without this, strictPort makes every restart after a dirty
// shutdown fail with EADDRINUSE.

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const PORTS = [46173, 47100];
const REPO_HINT = process.cwd().replace(/\\/g, '/');

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function killPids(pids) {
  for (const pid of pids) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 1 || n === process.pid) continue;
    try {
      process.kill(n, 'SIGKILL');
      console.log(`[dev-kill] killed stale pid ${n}`);
    } catch {
      /* already gone */
    }
  }
}

function pidsOnPort(port) {
  if (process.platform === 'win32') {
    const out = tryRun('netstat', ['-ano', '-p', 'tcp']);
    if (!out) return [];
    return [
      ...new Set(
        out
          .split('\n')
          .filter((l) => l.includes(`:${port}`) && l.includes('LISTENING'))
          .map((l) => l.trim().split(/\s+/).pop()),
      ),
    ];
  }
  const lsof = tryRun('lsof', ['-ti', `tcp:${port}`, '-s', 'tcp:LISTEN']);
  if (lsof !== null) return lsof.split('\n').map((s) => s.trim()).filter(Boolean);
  // No lsof — ask fuser for the pids directly.
  const fuser = tryRun('fuser', [`${port}/tcp`]);
  if (fuser !== null) return fuser.split(/\s+/).filter(Boolean);
  return [];
}

function staleRepoProcesses() {
  if (process.platform === 'win32') return [];
  const out = tryRun('pgrep', ['-f', 'electron']);
  if (!out) return [];
  const pids = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return pids.filter((pid) => {
    const cmd = tryRun('ps', ['-p', pid, '-o', 'args=']);
    return cmd && cmd.includes(REPO_HINT) && /electron/.test(cmd);
  });
}

const killed = new Set();
for (const port of PORTS) for (const pid of pidsOnPort(port)) killed.add(pid);
for (const pid of staleRepoProcesses()) killed.add(pid);
killed.delete(String(process.pid));
killPids([...killed]);
if (killed.size === 0) console.log('[dev-kill] clean — no stale listeners');
