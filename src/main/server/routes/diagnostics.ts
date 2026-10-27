import { Hono } from 'hono';
import path from 'node:path';
import { readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { diskLevel, formatBytes } from '../../../shared/diskSpace';
import { judgeProviderProbe, overallStatus, type CheckResult } from '../../../shared/healthCheck';
import { resolveSettingsModel } from '../providerResolver';
import { loadSkills } from '../../skills';
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
async function probeProvider(settingsStore: SettingsStore): Promise<CheckResult> {
  let resolved: ReturnType<typeof resolveSettingsModel>;
  try {
    resolved = resolveSettingsModel(await settingsStore.get(), { category: 'llm' });
  } catch (error) {
    return { id: 'provider', label: '模型服务', status: 'fail', detail: error instanceof Error ? error.message : '还没有配置可用的模型服务' };
  }
  const started = Date.now();
  try {
    const res = await fetch(`${resolved.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${resolved.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    const text = res.ok ? '' : await res.text().catch(() => '');
    return judgeProviderProbe(resolved.providerId, { status: res.status, error: text.slice(0, 500), ms: Date.now() - started });
  } catch (error) {
    return judgeProviderProbe(resolved.providerId, { error: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
  }
}

async function checkDataDir(dataRoot: string): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const probe = path.join(dataRoot, `.write-check-${process.pid}`);
  try {
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    out.push({ id: 'data-dir', label: '数据目录', status: 'ok', detail: '可以写入' });
  } catch (error) {
    out.push({ id: 'data-dir', label: '数据目录', status: 'fail', detail: `无法写入数据目录：${error instanceof Error ? error.message : String(error)}` });
  }
  try {
    const stats = await statfs(dataRoot);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const level = diskLevel(free);
    out.push({ id: 'disk', label: '磁盘空间', status: level === 'ok' ? 'ok' : level === 'low' ? 'warn' : 'fail', detail: `剩余 ${formatBytes(free)}` });
  } catch { /* an unreadable disk is not worth a row */ }
  return out;
}

async function checkMcp(dataRoot: string): Promise<CheckResult> {
  try {
    const raw = await readFile(path.join(dataRoot, 'mcp.json'), 'utf8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const count = Object.keys(parsed.mcpServers ?? {}).length;
    return { id: 'mcp', label: '外部工具（MCP）', status: 'ok', detail: count ? `已配置 ${count} 个服务（未逐个连接，可在设置里点「测试」）` : '没有配置' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { id: 'mcp', label: '外部工具（MCP）', status: 'ok', detail: '没有配置' };
    return { id: 'mcp', label: '外部工具（MCP）', status: 'fail', detail: 'mcp.json 不是有效的 JSON，外部工具不会加载' };
  }
}

export function createDiagnosticsRouter(options: { dataRoot: string; settingsStore: SettingsStore; skillsDirs?: string[] }) {
  const router = new Hono();

  // The recorded turns of one conversation (newest last), scrubbed the same way as the support bundle.
  router.get('/traces/:sessionId', async (c) => {
    // Same file-name rule the trace writer uses, so only this conversation's own file can be reached.
    const file = path.join(options.dataRoot, 'traces', `${c.req.param('sessionId').replace(/[^\w.-]/g, '_')}.jsonl`);
    const lines = (await readFile(file, 'utf8').catch((): string => '')).split(/\r?\n/).filter(Boolean).slice(-30);
    const traces: unknown[] = [];
    for (const line of lines) { try { traces.push(scrubValue(JSON.parse(line))); } catch { /* skip a torn line */ } }
    return c.json({ traces });
  });

  // One-click self-check: each row says what was tested and what to do about a failure.
  router.get('/check', async (c) => {
    const results: CheckResult[] = [];
    results.push(...await checkDataDir(options.dataRoot));
    results.push(await probeProvider(options.settingsStore));
    results.push(await checkMcp(options.dataRoot));
    try {
      const skills = await loadSkills(options.skillsDirs ?? []);
      results.push({ id: 'skills', label: '技能', status: 'ok', detail: `已加载 ${skills.length} 个` });
    } catch (error) {
      results.push({ id: 'skills', label: '技能', status: 'fail', detail: `技能目录读取失败：${error instanceof Error ? error.message : String(error)}` });
    }
    return c.json({ status: overallStatus(results), results });
  });

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
