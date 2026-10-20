import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VideoExportTasks, type ExportTaskTransport } from './exportTasks';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function fixture(overrides: Partial<ExportTaskTransport> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-export-tasks-'));
  const request = vi.fn(async (method: string, id?: string, body?: Record<string, unknown>) => method === 'POST'
    ? Response.json({ renderId: body?.operationId })
    : method === 'DELETE' ? new Response(null, { status: 204 })
    : Response.json({ id, status: 'succeeded', progress: 100, result: { path: '/media/uploads/result.mp4', codec: 'h264' } }));
  const output = vi.fn(async () => Buffer.from('output'));
  const save = vi.fn(async () => ({ id: 'saved-asset' }));
  const transport = { request, output, save, ...overrides };
  const tasks = new VideoExportTasks(root, transport, 5);
  cleanups.push(async () => { tasks.stop(); await tasks.settled(); await rm(root, { recursive: true, force: true }); });
  const body = { operationId: randomUUID(), format: 'video', codec: 'h264', name: '测试', state: { items: [] as unknown[] }, project: { id: 'project' } };
  return { root, tasks, transport, request, output, save, body };
}
async function phase(tasks: VideoExportTasks, id: string, expected: string) {
  await vi.waitFor(async () => expect((await tasks.snapshot('session', id)).task.phase).toBe(expected));
}

it('accepts one immutable recipe durably, publishes success only after host commit, and isolates conversations', async () => {
  const commit = deferred<{ id: string }>();
  const { tasks, body, request, root } = await fixture({ save: () => commit.promise });
  const [a, b] = await Promise.all([tasks.create('session', 'project', body), tasks.create('session', 'project', body)]);
  expect(a.id).toBe(b.id);
  await phase(tasks, a.id, 'saving');
  expect((await tasks.snapshot('session', a.id)).status).toBe('running');
  const disk = JSON.parse(await readFile(path.join(root, 'video-editor-export-jobs', `${a.id}.json`), 'utf8'));
  expect(disk.recipe).toMatchObject({ operationId: a.id, project: { id: 'project' } });
  expect(disk.assetId).toBeUndefined();
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
  await expect(tasks.create('other', 'project', body)).rejects.toThrow('编号');
  await expect(tasks.snapshot('other', a.id)).rejects.toThrow('当前对话');
  await expect(tasks.create('session', 'project', { ...body, name: 'changed' })).rejects.toThrow('编号');
  expect(await tasks.list('other')).toEqual([]);
  commit.resolve({ id: 'committed' });
  await phase(tasks, a.id, 'saved');
  expect((await tasks.snapshot('session', a.id)).task.assetId).toBe('committed');
});

it('reconciles a lost submission reply without reposting, and retries a failed job once under a new identity', async () => {
  let fail = true;
  const request = vi.fn(async (method: string, id?: string) => {
    if (method === 'POST') throw new Error('lost response');
    return Response.json({ id, status: fail ? 'failed' : 'succeeded', progress: 100, error: 'fixture failure', result: { path: '/media/uploads/result.mp4' } });
  });
  const { tasks, body } = await fixture({ request });
  const job = await tasks.create('session', 'project', body);
  await phase(tasks, job.id, 'failed');
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
  fail = false;
  const [a, b] = await Promise.all([tasks.retry('session', job.id), tasks.retry('session', job.id)]);
  expect(a.id).toBe(b.id); expect(a.id).not.toBe(job.id);
  await phase(tasks, a.id, 'saved');
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(2);
});

it('waits for an in-flight submission before cancelling and never delivers its output', async () => {
  const submitted = deferred<Response>();
  const request = vi.fn(async (method: string) => method === 'POST' ? submitted.promise : new Response(null, { status: 204 }));
  const { tasks, body, save } = await fixture({ request });
  const job = await tasks.create('session', 'project', body);
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  await tasks.cancel('session', job.id);
  expect(request.mock.calls.filter(([method]) => method === 'DELETE')).toHaveLength(0);
  submitted.resolve(Response.json({ renderId: job.id }));
  await phase(tasks, job.id, 'cancelled');
  expect(request.mock.calls.map(([method]) => method)).toEqual(['POST', 'DELETE']);
  expect(save).not.toHaveBeenCalled();
});

it('recovers rendering after host restart without resubmission, and recovers a committed asset before its ledger receipt', async () => {
  let finished = false;
  const request = vi.fn(async (method: string, id?: string, body?: Record<string, unknown>) => method === 'POST'
    ? Response.json({ renderId: body?.operationId })
    : Response.json({ id, status: finished ? 'succeeded' : 'running', progress: 40, result: finished ? { path: '/media/uploads/result.mp4' } : undefined }));
  const saved = new Map<string, string>();
  const save = vi.fn(async (_session: string, _project: string, _name: string, bytes: Buffer) => {
    const key = bytes.toString(); const id = saved.get(key) ?? randomUUID(); saved.set(key, id); return { id };
  });
  const { tasks, root, transport, body } = await fixture({ request, save });
  const job = await tasks.create('session', 'project', body);
  await phase(tasks, job.id, 'rendering');
  tasks.stop(); await tasks.settled(); finished = true;
  const recovered = new VideoExportTasks(root, transport, 5);
  cleanups.push(async () => { recovered.stop(); await recovered.settled(); });
  await recovered.start(); await phase(recovered, job.id, 'saved');
  recovered.stop(); await recovered.settled();
  const file = path.join(root, 'video-editor-export-jobs', `${job.id}.json`);
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  // Crash after the asset transaction committed, before the host wrote its saved receipt.
  await writeFile(file, JSON.stringify({ ...receipt, phase: 'saving', assetId: undefined }));
  const again = new VideoExportTasks(root, transport, 5);
  cleanups.push(async () => { again.stop(); await again.settled(); });
  await again.start(); await phase(again, job.id, 'saved');
  expect((await again.snapshot('session', job.id)).task.assetId).toBe(receipt.assetId);
  expect(saved.size).toBe(1); expect(save).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
});

it('does not call an unknown submission cancelled or blindly retry a live interrupted job', async () => {
  let live = false;
  const request = vi.fn(async (method: string, id?: string) => {
    if (method === 'POST') throw new Error('unknown submission');
    return live ? Response.json({ id, status: 'running', progress: 35 }) : new Response(null, { status: 404 });
  });
  const { tasks, body } = await fixture({ request });
  const job = await tasks.create('session', 'project', body);
  await tasks.cancel('session', job.id);
  await phase(tasks, job.id, 'interrupted');
  live = true;
  await tasks.retry('session', job.id);
  await phase(tasks, job.id, 'cancelled');
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
});

it('accepts identity-free upstream documents and permits a fresh render when the completed output is missing', async () => {
  let missing = true;
  const { tasks, body, request } = await fixture({ output: async () => {
    if (missing) throw Object.assign(new Error('output expired'), { code: 'OUTPUT_MISSING' });
    return Buffer.from('restored');
  } });
  const job = await tasks.create('session', 'project', { ...body, project: { version: 1, timelines: [] as unknown[] } });
  await phase(tasks, job.id, 'failed');
  missing = false;
  const next = await tasks.retry('session', job.id);
  expect(next.id).not.toBe(job.id); await phase(tasks, next.id, 'saved');
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(2);
});

it('reports the engine restart outcome as interrupted instead of saved or silently replaying it', async () => {
  const request = vi.fn(async (method: string, id?: string, body?: Record<string, unknown>) => method === 'POST'
    ? Response.json({ renderId: body?.operationId })
    : Response.json({ id, status: 'failed', code: 'resumer_unavailable', error: 'no resumer registered', progress: 100 }));
  const { tasks, body, save } = await fixture({ request });
  const job = await tasks.create('session', 'project', body);
  await phase(tasks, job.id, 'interrupted');
  expect((await tasks.snapshot('session', job.id)).error).toContain('重启');
  expect(save).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
});
