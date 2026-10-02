import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { CanvasNodeOutput } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import { nodeJobsFor } from '../canvas/nodeJobs';
import { canvasAssetsDir, startImageNode } from '../canvas/imageExecutor';
import { stopCanvasWork } from '../canvas/workLifecycle';
import { createCanvasApplication } from '../canvas/application';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('./provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
import { createImageTools } from './imageTools';

const image = { images: [{ uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }] };
const cleanups: Array<() => Promise<void>> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => generate.mockReset());
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvasStore = createCanvasStore(handle);
  const session = await sessions.create('inline images', null, null);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-inline-jobs-'));
  const settingsStore = { get: async () => ({ activeProviderId: 'openai', providers: { openai: { apiKey: 'fake', baseUrl: 'https://example.test/v1' } } }) } as unknown as SettingsStore;
  const options = { settingsStore, dataRoot, sessionId: session.id, canvasStore };
  let closed = false;
  const close = () => { handle.close(); closed = true; };
  cleanups.push(async () => {
    if (!closed) { stopCanvasWork(canvasStore); nodeJobsFor(canvasStore).shutdown(); close(); }
    if (!path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary test directory escaped its root');
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { canvasStore, options, tools: createImageTools(options), dataRoot, sessionId: session.id, close };
}

type InlineResult = { ok: boolean; jobId?: string; imageUrl?: string; prompt?: string; size?: string; model?: string; error?: string };
type EditResult = { ok: boolean; id?: string; jobId?: string; error?: string };

describe('session image tools use durable jobs', () => {
  it('keeps inline output fields and legacy image sizes while persisting a reusable session asset', async () => {
    const { canvasStore, sessionId, tools } = await fixture();
    generate.mockResolvedValue(image);
    const execute = tools.generate_image.execute as (input: { prompt: string; size: string; model?: string }, context: { toolCallId: string }) => Promise<InlineResult>;
    const result = await execute({ prompt: 'a poster', size: '1792x1024', model: 'gpt-image-2' }, { toolCallId: 'inline-1' });
    expect(result).toMatchObject({ ok: true, prompt: 'a poster', size: '1792x1024', model: 'gpt-image-2' });
    const canvas = canvasStore.getSnapshotBySession(sessionId);
    expect(canvas.nodes).toHaveLength(1);
    expect(canvas.nodes[0].params).toMatchObject({ origin: 'chat', size: '1792x1024' });
    const job = canvasStore.jobs.get(result.jobId);
    expect(job).toMatchObject({ status: 'succeeded', canvasId: canvas.canvas.id, nodeId: canvas.nodes[0].id });
    expect(result.imageUrl).toBe(`/api/canvas/assets/${(job.result as CanvasNodeOutput).assets[0]}`);
    expect(generate.mock.calls[0][0]).toMatchObject({ size: '1792x1024', maxRetries: 0 });
  });

  it('replaying the same tool call reuses both its node and accepted job without another paid call', async () => {
    const { canvasStore, sessionId, tools } = await fixture();
    const pending = deferred<typeof image>();
    generate.mockReturnValue(pending.promise);
    const execute = tools.generate_image.execute as (input: { prompt: string; size: string }, context: { toolCallId: string }) => Promise<InlineResult>;
    const args = { prompt: 'one image', size: '512x512' };
    const first = execute(args, { toolCallId: 'same-tool-call' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const replay = execute(args, { toolCallId: 'same-tool-call' });
    pending.resolve(image);
    const [a, b] = await Promise.all([first, replay]);
    expect(b.jobId).toBe(a.jobId);
    expect(b.imageUrl).toBe(a.imageUrl);
    expect(canvasStore.getSnapshotBySession(sessionId).nodes).toHaveLength(1);
    expect(canvasStore.jobs.list()).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    const again = await execute(args, { toolCallId: 'same-tool-call' });
    expect(again.imageUrl).toBe(a.imageUrl);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('returns the matched job result even if that node receives a newer generation before replay', async () => {
    const { canvasStore, tools, options, sessionId } = await fixture();
    generate.mockResolvedValue(image);
    const execute = tools.generate_image.execute as (input: { prompt: string; size: string }, context: { toolCallId: string }) => Promise<InlineResult>;
    const args = { prompt: 'original image', size: '1024x1792' };
    const original = await execute(args, { toolCallId: 'original-operation' });
    const snap = canvasStore.getSnapshotBySession(sessionId);
    const node = snap.nodes[0];
    canvasStore.updateNode(snap.canvas.id, node.id, { params: { prompt: 'newer image', size: '1024x1024' } });
    await startImageNode({ ...options, canvasId: snap.canvas.id, node }).completion;
    const latest = canvasStore.getNode(snap.canvas.id, node.id);
    expect(`/api/canvas/assets/${latest.output.assets[0]}`).not.toBe(original.imageUrl);
    const replay = await execute(args, { toolCallId: 'original-operation' });
    expect(replay).toMatchObject({ imageUrl: original.imageUrl, prompt: 'original image', size: '1024x1792', jobId: original.jobId });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('host exit releases inline wait without querying the already closed database', async () => {
    const { canvasStore, tools, close } = await fixture();
    const pending = deferred<typeof image>();
    generate.mockReturnValue(pending.promise);
    const execute = tools.generate_image.execute as (input: { prompt: string; size: string }, context: { toolCallId: string }) => Promise<InlineResult>;
    const running = execute({ prompt: 'image', size: '1024x1024' }, { toolCallId: 'shutdown-image' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    stopCanvasWork(canvasStore);
    nodeJobsFor(canvasStore).shutdown();
    close();
    const read = vi.spyOn(canvasStore.jobs, 'get');
    expect(await running).toMatchObject({ ok: false, error: expect.stringMatching(/中断/) });
    expect(read).not.toHaveBeenCalled();
    pending.resolve(image);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
  });

  it('edit admission commits one node-and-edge batch and tool replay does not duplicate the structure or provider', async () => {
    const { canvasStore, tools, dataRoot, sessionId } = await fixture();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const src = canvasStore.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 320, h: 380, params: { size: '1024x1024' } }).node;
    await mkdir(canvasAssetsDir(dataRoot, canvas.id), { recursive: true });
    await writeFile(path.join(canvasAssetsDir(dataRoot, canvas.id), 'src.png'), new Uint8Array([1, 2, 3]));
    canvasStore.updateNode(canvas.id, src.id, { output: { assets: [`${canvas.id}/src.png`] } });
    generate.mockResolvedValue(image);
    const execute = tools.canvas_edit_image.execute as (input: { nodeId: string; kind: string }, context: { toolCallId: string }) => Promise<EditResult>;
    const args = { nodeId: src.id, kind: 'matting' };
    const before = canvasStore.getCanvas(canvas.id).liveRevision;
    const accepted = await execute(args, { toolCallId: 'edit-tool-call' });
    expect(accepted.ok).toBe(true);
    const commits = canvasStore.readCommitsAfter(canvas.id, before);
    expect(commits.commits[0].changes.filter((change) => change.type === 'node_added' || change.type === 'edge_added')).toHaveLength(2);
    await vi.waitFor(() => expect(canvasStore.jobs.get(accepted.jobId)?.status).toBe('succeeded'));
    createCanvasApplication(canvasStore).deleteNode(canvas.id, src.id);
    const replay = await execute(args, { toolCallId: 'edit-tool-call' });
    expect(replay).toMatchObject({ ok: true, id: accepted.id, jobId: accepted.jobId });
    expect(canvasStore.getSnapshot(canvas.id).nodes).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await readdir(canvasAssetsDir(dataRoot, canvas.id))).toHaveLength(2);
  });

  it('a rejected source edge rolls back edit node creation before job admission', async () => {
    const { canvasStore, tools, sessionId } = await fixture();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const src = canvasStore.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 320, h: 380, params: {} }).node;
    canvasStore.updateNode(canvas.id, src.id, { output: { assets: [`${canvas.id}/src.png`] } });
    vi.spyOn(canvasStore, 'addEdge').mockReturnValue({ error: 'incompatible' });
    const execute = tools.canvas_edit_image.execute as (input: { nodeId: string; kind: string }, context: { toolCallId: string }) => Promise<EditResult>;
    const result = await execute({ nodeId: src.id, kind: 'matting' }, { toolCallId: 'failed-edge' });
    expect(result.ok).toBe(false);
    expect(canvasStore.getSnapshot(canvas.id).nodes).toHaveLength(1);
    expect(canvasStore.jobs.list()).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });
});
