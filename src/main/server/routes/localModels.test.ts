import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalModelsRouter } from './localModels';

const servers: http.Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

async function fakeOllama(models: string[]): Promise<string> {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: models.map((id) => ({ id })) })); } else { res.statusCode = 404; res.end(); }
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

function makeRouter(endpoints: Array<{ providerId: string; name: string; baseUrl: string }>) {
  const patches: unknown[] = [];
  const router = createLocalModelsRouter({ settingsStore: { applyPatch: async (p: unknown) => { patches.push(p); return {}; } } as never, endpoints, timeoutMs: 800 });
  return { router, patches };
}
const post = (router: ReturnType<typeof createLocalModelsRouter>, body: unknown) => router.request('/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('local model discovery', () => {
  it('finds a running server with its chat models, and says plainly when one is not running', async () => {
    const up = await fakeOllama(['llama3.1:8b', 'nomic-embed-text']);
    const { router } = makeRouter([{ providerId: 'ollama', name: 'Ollama', baseUrl: up }, { providerId: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:9/v1' }]);
    const { servers: found } = (await (await router.request('/')).json()) as { servers: Array<{ providerId: string; reachable: boolean; models: Array<{ id: string }>; message?: string }> };
    expect(found[0]).toMatchObject({ providerId: 'ollama', reachable: true });
    expect(found[0].models.map((m) => m.id)).toEqual(['llama3.1:8b']);
    expect(found[1].reachable).toBe(false);
    expect(found[1].message).toContain('未检测到本地服务');
  });

  it('connect sets the provider up with no key typed, picks a model and makes it active', async () => {
    const up = await fakeOllama(['llama3.1:8b', 'qwen2.5']);
    const { router, patches } = makeRouter([{ providerId: 'ollama', name: 'Ollama', baseUrl: up }]);
    const res = await post(router, { providerId: 'ollama', model: 'qwen2.5' });
    expect(res.status).toBe(200);
    expect(patches[0]).toMatchObject({ activeProviderId: 'ollama', provider: { id: 'ollama', apiKey: 'local', baseUrl: up, model: 'qwen2.5' } });
  });

  it('connect refuses with a clear reason when nothing is running or nothing is installed', async () => {
    const empty = await fakeOllama([]);
    const { router, patches } = makeRouter([{ providerId: 'ollama', name: 'Ollama', baseUrl: empty }, { providerId: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:9/v1' }]);
    const none = await post(router, { providerId: 'ollama' });
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: string }).error).toContain('ollama pull');
    const down = await post(router, { providerId: 'lmstudio' });
    expect(down.status).toBe(503);
    expect(((await down.json()) as { error: string }).error).toContain('未检测到本地服务');
    expect((await post(router, { providerId: 'nope' })).status).toBe(400);
    expect(patches).toEqual([]);
  });
});
