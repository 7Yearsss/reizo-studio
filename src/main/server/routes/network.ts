import { Hono } from 'hono';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeTextAtomic } from '../storage/atomicFile';
import { applyProxy, currentProxyUrl } from '../../proxy';
import { applyEgress, recentlyBlocked } from '../../egressControl';
import { DEFAULT_EGRESS, normalizeEgress, withAllowedHost, type EgressSettings } from '../../../shared/egressSettings';
import { DEFAULT_PROXY, explainProxyFailure, normalizeProxy, type ProxySettings } from '../../../shared/proxySettings';

const fileOf = (dataRoot: string) => path.join(dataRoot, 'network.json');

const egressFile = (dataRoot: string) => path.join(dataRoot, 'egress.json');

export async function readEgressSettings(dataRoot: string): Promise<EgressSettings> {
  try { return normalizeEgress(JSON.parse(await readFile(egressFile(dataRoot), 'utf8'))); } catch { return { ...DEFAULT_EGRESS, allow: [] }; }
}

export async function readNetworkSettings(dataRoot: string): Promise<ProxySettings> {
  try { return normalizeProxy(JSON.parse(await readFile(fileOf(dataRoot), 'utf8'))); } catch { return { ...DEFAULT_PROXY }; }
}

/** Proxy settings (direct / system / custom), saved next to the other app data and applied at once and at every start. */
export function createNetworkRouter(options: { dataRoot: string; resolveSystem?: (url: string) => Promise<string> }) {
  const router = new Hono();
  // Chromium's view of the OS proxy; only exists inside Electron (a plain Node run falls back to direct).
  const resolveSystem = options.resolveSystem ?? (async (url: string): Promise<string> => {
    const electron = await import('electron');
    return electron.session.defaultSession.resolveProxy(url);
  });
  const apply = (settings: ProxySettings) => applyProxy(settings, resolveSystem);

  void readNetworkSettings(options.dataRoot).then(apply).catch((): void => undefined);

  // Network isolation for commands the agent runs (an allowlist proxy); saved and applied at once and at every start.
  let egressSaved = false;
  // The boot-time read must not overwrite a change the user already made.
  void readEgressSettings(options.dataRoot).then((stored) => (egressSaved ? undefined : applyEgress(stored))).catch((): void => undefined);
  const saveEgress = async (next: EgressSettings): Promise<EgressSettings> => {
    egressSaved = true;
    await applyEgress(next);
    await writeTextAtomic(egressFile(options.dataRoot), JSON.stringify(next, null, 2));
    return next;
  };
  router.get('/egress', async (c) => c.json({ settings: await readEgressSettings(options.dataRoot), blocked: recentlyBlocked() }));
  router.put('/egress', async (c) => {
    try { return c.json({ settings: await saveEgress(normalizeEgress(await c.req.json().catch((): null => null))) }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : '无法启动网络隔离' }, 500); }
  });
  // Forget every login the assistant's browser profile holds (the window opened by browser_open).
  router.post('/browser/clear', async (c) => {
    try { await (await import('../../pageReader')).clearBrowserLogins(); return c.json({ ok: true }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : '清除失败' }, 500); }
  });
  // The "allow this host" button on a blocked command.
  router.post('/egress/allow', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as { host?: unknown } | null;
    const current = await readEgressSettings(options.dataRoot);
    const next = typeof body?.host === 'string' ? withAllowedHost(current, body.host) : current;
    return c.json({ settings: next === current ? current : await saveEgress(next) });
  });

  router.get('/', async (c) => c.json({ settings: await readNetworkSettings(options.dataRoot), effective: currentProxyUrl()?.replace(/\/\/[^@/]*@/, '//***@') ?? null }));

  router.put('/', async (c) => {
    const settings = normalizeProxy(await c.req.json().catch((): null => null));
    await writeTextAtomic(fileOf(options.dataRoot), JSON.stringify(settings, null, 2));
    const { effective, error } = await apply(settings);
    return c.json({ settings, effective: effective?.replace(/\/\/[^@/]*@/, '//***@') ?? null, ...(error ? { error } : {}) });
  });

  // Reach a real HTTPS host through whatever is configured now. Any HTTP answer proves the path works.
  router.post('/test', async (c) => {
    const started = Date.now();
    try {
      const res = await fetch('https://api.openai.com/v1/models', { signal: AbortSignal.timeout(10_000) });
      if (res.status === 407) return c.json({ ok: false, ms: Date.now() - started, detail: explainProxyFailure('', 407) });
      return c.json({ ok: true, ms: Date.now() - started, detail: `能连上（${Date.now() - started} ms，HTTP ${res.status}）` });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const text = [cause?.code, cause?.message, error instanceof Error ? error.message : ''].filter(Boolean).join(' ');
      return c.json({ ok: false, ms: Date.now() - started, detail: explainProxyFailure(text) });
    }
  });

  return router;
}
