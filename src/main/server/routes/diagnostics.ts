import { Hono } from 'hono';
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { scrubValue } from '../../../shared/diagnosticScrub';
import type { SettingsStore } from '../storage/settingsStore';

const MAX_TRACE_FILES = 5;
const MAX_TRACES_PER_FILE = 8;

/** The newest per-turn traces, parsed line by line; unreadable lines are skipped. */
async function recentTraces(dataRoot: string): Promise<unknown[]> {
  const dir = path.join(dataRoot, 'traces');
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl')); } catch { return []; }
  const dated = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(path.join(dir, name)).catch((): null => null))?.mtimeMs ?? 0 })));
  const newest = dated.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_TRACE_FILES);
  const out: unknown[] = [];
  for (const { name } of newest) {
    const lines = (await readFile(path.join(dir, name), 'utf8').catch(() => '')).split('\n').filter(Boolean).slice(-MAX_TRACES_PER_FILE);
    for (const line of lines) { try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ } }
  }
  return out;
}

/**
 * A support bundle the user can read and then send: versions, settings and recent turn traces. Everything passes
 * through the scrubber (secret field names, secret-shaped values, inline images); there is no switch to turn that off.
 */
export function createDiagnosticsRouter(options: { dataRoot: string; settingsStore: SettingsStore }) {
  const router = new Hono();
  router.get('/bundle', async (c) => {
    const settings = await options.settingsStore.getPublic();
    const bundle = {
      generatedAt: new Date().toISOString(),
      runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron, chrome: process.versions.chrome },
      settings,
      traces: await recentTraces(options.dataRoot),
    };
    return c.json(scrubValue(bundle));
  });
  return router;
}
