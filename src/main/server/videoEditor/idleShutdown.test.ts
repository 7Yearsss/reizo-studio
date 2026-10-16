import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VideoEditorService, type VideoEditorEngine } from './service';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of cleanup.splice(0).reverse()) await fn(); });

interface Fixture { service: VideoEditorService; launches: () => number; kills: () => number; connected: { ids: string[]; fail: boolean }; origin: string }

/** Fake engine: answers the MCP handshake and `openchatcut_status` with a configurable panel connection. */
async function fixture(idleMs: number): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-idle-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const connected = { ids: [] as string[], fail: false };
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    if (req.url?.startsWith('/export/job')) { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.method === 'initialize') { res.setHeader('mcp-session-id', 'owner'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: request.id, result: {} })); return; }
    if (request.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (connected.fail) { res.writeHead(500); res.end(); return; }
    const value = request.params.name === 'openchatcut_status' ? { connectedProjectIds: connected.ids } : {};
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let launches = 0, kills = 0;
  const launch = async (): Promise<VideoEditorEngine> => { launches++; return { origin, token: 'test', kill() { kills++; } }; };
  const service = new VideoEditorService(root, launch, idleMs);
  cleanup.push(async () => service.stop());
  return { service, launches: () => launches, kills: () => kills, connected, origin };
}

const touch = (service: VideoEditorService) => service.renderRequest('GET', '11111111-1111-1111-1111-111111111111').then((r) => r.body?.cancel());

beforeEach(() => { vi.restoreAllMocks(); });

it('stops an idle engine with no panel connected and relaunches it on next use', async () => {
  const f = await fixture(60_000);
  await touch(f.service);
  expect(f.launches()).toBe(1);
  expect(await f.service.shutdownIfIdle()).toBe(true);
  expect(f.kills()).toBe(1);
  await touch(f.service);
  expect(f.launches()).toBe(2);
});

it('keeps the engine while an editor panel is connected', async () => {
  const f = await fixture(60_000);
  await touch(f.service);
  f.connected.ids = ['project-1'];
  expect(await f.service.shutdownIfIdle()).toBe(false);
  expect(f.kills()).toBe(0);
});

it('keeps the engine when it cannot tell whether a panel is connected', async () => {
  const f = await fixture(60_000);
  await touch(f.service);
  f.connected.fail = true;
  expect(await f.service.shutdownIfIdle()).toBe(false);
  expect(f.kills()).toBe(0);
});

it('keeps the engine while an export task or a call is active', async () => {
  const f = await fixture(60_000);
  await touch(f.service);
  let exporting = true;
  const remove = f.service.addBusyProbe(() => exporting);
  expect(await f.service.shutdownIfIdle()).toBe(false);
  expect(f.kills()).toBe(0);
  exporting = false;
  expect(await f.service.shutdownIfIdle()).toBe(true);
  remove();
});

it('does not stop the engine while a request is in flight', async () => {
  const f = await fixture(60_000);
  await touch(f.service);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const running = (f.service as unknown as { track<T>(work: () => Promise<T>): Promise<T> }).track(() => held);
  expect(await f.service.shutdownIfIdle()).toBe(false);
  expect(f.kills()).toBe(0);
  release(); await running;
  expect(await f.service.shutdownIfIdle()).toBe(true);
});

it('shuts down automatically after the idle period and activity postpones it', async () => {
  const f = await fixture(150);
  await touch(f.service);
  await new Promise((resolve) => setTimeout(resolve, 90));
  await touch(f.service); // resets the countdown
  await new Promise((resolve) => setTimeout(resolve, 90));
  expect(f.kills()).toBe(0);
  await vi.waitFor(() => expect(f.kills()).toBe(1), { timeout: 2000 });
});

it('never auto-stops when the idle period is 0', async () => {
  const f = await fixture(0);
  await touch(f.service);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(f.kills()).toBe(0);
});
