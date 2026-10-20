import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { VideoEditorService } from './service';
import { editorResult } from './mcpClient';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

it('renders over the trusted loopback transport without a browser or MCP session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-render-http-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const server = createServer(async (req, res) => {
    if (req.url === '/media/uploads/result.mp4') { res.end('media'); return; }
    expect(req.headers['sec-fetch-site']).toBe('none');
    expect(req.headers.origin).toBe(`http://${req.headers.host}`);
    expect(req.url).toMatch(/^\/export\/job/);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ renderId: id }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const service = new VideoEditorService(root, async () => ({ origin, token: 'test', kill() { /* fixture owns cleanup */ } }));
  expect(await (await service.renderRequest('POST', undefined, { operationId: id })).json()).toEqual({ renderId: id });
  expect(await (await service.renderRequest('GET', id)).json()).toEqual({ renderId: id });
  await service.renderRequest('DELETE', id);
  expect((await service.renderOutput('/media/uploads/result.mp4', new AbortController().signal)).toString()).toBe('media');
  await expect(service.renderRequest('GET', '../settings')).rejects.toThrow('编号');
  await expect(service.renderOutput('https://example.com/private.mp4', new AbortController().signal)).rejects.toThrow('路径');
  service.stop();
});

it('isolates conversation projects, persists bindings and forces manual draft review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-video-test-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let projects = 0;
  let owners = 0;
  let revisionProbes = 0;
  let beginCalls = 0;
  let targetCalls = 0;
  const targets = new Map<string, string>();
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.method === 'initialize') {
      res.setHeader('mcp-session-id', `owner-${++owners}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: request.id, result: {} })); return;
    }
    if (request.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    const { name, arguments: args } = request.params;
    const owner = String(req.headers['mcp-session-id']);
    if (name === 'list_edit_sessions' && ++revisionProbes === 1) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: request.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ outcome: 'stale' }) }] } })); return;
    }
    if (name === 'begin_edit_session' && ++beginCalls === 1) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: request.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ outcome: 'stale', message: `Project ${args.editorProjectId} changed; re-initialize the MCP session.` }) }] } })); return;
    }
    let value: unknown;
    if (name === 'create_project') value = { id: `project-${++projects}`, name: args.name };
    else if (name === 'list_edit_sessions') value = { result: [] };
    else if (name === 'openchatcut_status') value = { connectedProjectIds: Array.from({ length: projects }, (_, i) => `project-${i + 1}`) };
    else if (name === 'target_project') { targetCalls++; targets.set(owner, args.projectId); value = { ok: true }; }
    else value = { ...args, target: targets.get(owner) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port;
  const launch = async () => ({ origin: `http://127.0.0.1:${port}`, token: 'test', kill() { /* fixture server is cleaned up separately */ } });
  const service = new VideoEditorService(root, launch);
  const [a, same] = await Promise.all([service.open('chat-a', 'A'), service.open('chat-a', 'A')]);
  const b = await service.open('chat-b', 'B');
  expect(a.projectId).toBe(same.projectId);
  expect(a.projectId).not.toBe(b.projectId);
  expect(projects).toBe(2);
  const draft = editorResult(await service.call('chat-a', 'begin_edit_session', { approvalMode: 'auto' }));
  expect(draft.approvalMode).toBe('manual');
  expect(draft.target).toBe(a.projectId);
  expect(draft.editorProjectId).toBe(a.projectId);
  expect(revisionProbes).toBe(3);
  expect(beginCalls).toBe(2);
  const targetsBeforeTerminalRead = targetCalls;
  await service.call('chat-a', 'get_edit_session', { editSessionId: 'draft-a' });
  expect(targetCalls).toBe(targetsBeforeTerminalRead);
  await expect(service.call('chat-a', 'read_project', { editorProjectId: b.projectId })).rejects.toThrow('其他对话');
  const restored = new VideoEditorService(root, launch);
  expect((await restored.open('chat-a', 'A')).projectId).toBe(a.projectId);
  expect(projects).toBe(2);
  service.stop(); restored.stop();
});
