import { Hono } from 'hono';
import { LOCAL_ENDPOINTS, LOCAL_PLACEHOLDER_KEY, NOT_DETECTED, parseLocalModels, type LocalDiscovery, type LocalEndpoint } from '../../../shared/localModels';
import type { SettingsStore } from '../storage/settingsStore';

async function probe(endpoint: LocalEndpoint, timeoutMs: number): Promise<LocalDiscovery> {
  const base = { providerId: endpoint.providerId, name: endpoint.name, baseUrl: endpoint.baseUrl };
  try {
    const res = await fetch(`${endpoint.baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ...base, reachable: false, models: [], message: `${endpoint.name} 返回了 HTTP ${res.status}` };
    return { ...base, reachable: true, models: parseLocalModels(await res.json().catch((): null => null)) };
  } catch {
    return { ...base, reachable: false, models: [], message: NOT_DETECTED(endpoint.name) };
  }
}

/** Finds Ollama / LM Studio on this machine and connects one with a click: no key, no URL to type. */
export function createLocalModelsRouter(options: { settingsStore: SettingsStore; endpoints?: readonly LocalEndpoint[]; timeoutMs?: number }) {
  const endpoints = options.endpoints ?? LOCAL_ENDPOINTS;
  const timeoutMs = options.timeoutMs ?? 1200;
  const router = new Hono();

  router.get('/', async (c) => c.json({ servers: await Promise.all(endpoints.map((e) => probe(e, timeoutMs))) }));

  router.post('/connect', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as { providerId?: unknown; model?: unknown } | null;
    const endpoint = endpoints.find((e) => e.providerId === body?.providerId);
    if (!endpoint) return c.json({ error: '未知的本地服务' }, 400);
    const found = await probe(endpoint, timeoutMs);
    if (!found.reachable) return c.json({ error: found.message ?? NOT_DETECTED(endpoint.name) }, 503);
    if (found.models.length === 0) return c.json({ error: `${endpoint.name} 已在运行，但还没有可对话的模型：先下载一个（例如 ollama pull llama3.1）。` }, 409);
    const wanted = typeof body?.model === 'string' ? found.models.find((m) => m.id === body.model) : undefined;
    const model = (wanted ?? found.models[0]).id;
    await options.settingsStore.applyPatch({
      activeProviderId: endpoint.providerId,
      provider: { id: endpoint.providerId, apiKey: LOCAL_PLACEHOLDER_KEY, baseUrl: endpoint.baseUrl, model },
    });
    return c.json({ providerId: endpoint.providerId, model, models: found.models });
  });

  return router;
}
