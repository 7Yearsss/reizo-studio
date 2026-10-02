import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CanvasCommit, CanvasSyncMessage } from '../../../shared/canvasSync';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore, type CanvasStore } from '../storage/canvasStore';
import { createCanvasApplication } from './application';
import { CanvasChannel } from './channel';

const handles = new Set<DbHandle>();
const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const handle of handles) handle.close();
  handles.clear();
  for (const dir of tempDirs.splice(0)) {
    // Every deletion target is a directory created by this test under tmpdir.
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
  }
});

async function fixture(dbPath = ':memory:') {
  const handle = openDb(dbPath);
  handles.add(handle);
  const sessions = createSqliteSessionStore(handle);
  const store = createCanvasStore(handle);
  const session = await sessions.create('channel-test', null, null);
  const canvas = store.ensureCanvas(session.id);
  const channel = new CanvasChannel(canvas.id);
  return { handle, store, canvas, channel };
}

async function nextMessage(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<CanvasSyncMessage> {
  const result = await reader.read();
  expect(result.done).toBe(false);
  const text = new TextDecoder().decode(result.value);
  expect(text.split('\n').filter(Boolean)).toHaveLength(1);
  return JSON.parse(text) as CanvasSyncMessage;
}

function streamReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error('Expected a stream response body');
  return response.body.getReader();
}

function addNode(store: CanvasStore, canvasId: string) {
  return store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: {} });
}

describe('CanvasChannel v2', () => {
  it('publishes a compound document mutation as one atomic batch and never duplicates legacy broadcasts', async () => {
    vi.useFakeTimers();
    const { store, canvas, channel } = await fixture();
    const app = createCanvasApplication(store, { publish: (_id, revision, event) => channel.broadcast(revision, event) });
    const reader = streamReader(channel.streamCommits(store, 0));
    const added = app.batch(canvas.id, { kind: 'two-nodes-one-edge' }, () => {
      const source = app.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
      const target = app.addNode(canvas.id, { type: 'image', x: 200, y: 0, w: 100, h: 100 }).node;
      app.addEdge(canvas.id, { sourceId: source.id, targetId: target.id });
      return { source, target };
    });
    const message = await nextMessage(reader);
    expect(message.kind).toBe('commit');
    if (message.kind !== 'commit') throw new Error('Expected transaction commit');
    expect(message.commit.revision).toBe(1);
    expect(message.commit.changes.filter((change) => change.type === 'node_added')).toHaveLength(2);
    expect(message.commit.changes.filter((change) => change.type === 'edge_added')).toHaveLength(1);
    expect(store.getNode(canvas.id, added.target.id)).not.toBeNull();
    vi.advanceTimersByTime(15_000);
    expect(await nextMessage(reader)).toMatchObject({ kind: 'heartbeat', revision: 1 });
    await reader.cancel();
  });

  it('replays commits from the persisted journal after reopening the database and channel', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-channel-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'sessions.db');
    const { store, canvas, handle } = await fixture(dbPath);
    const node = addNode(store, canvas.id).node;
    store.updateNode(canvas.id, node.id, { title: 'persisted change' });
    handle.close();
    handles.delete(handle);

    const reopened = openDb(dbPath);
    handles.add(reopened);
    const replayStore = createCanvasStore(reopened);
    const reader = streamReader(new CanvasChannel(canvas.id).streamCommits(replayStore, 1));
    const message = await nextMessage(reader);
    expect(message).toMatchObject({ v: 2, canvasId: canvas.id, kind: 'commit', commit: { revision: 2 } });
    if (message.kind !== 'commit') throw new Error('Expected replayed commit');
    expect(message.commit.changes).toContainEqual(expect.objectContaining({
      type: 'node_updated', node: expect.objectContaining({ title: 'persisted change' }),
    }));
    await reader.cancel();
  });

  it('deduplicates an already-replayed commit whose notification was queued before subscription', async () => {
    vi.useFakeTimers();
    const { store, canvas, channel } = await fixture();
    addNode(store, canvas.id);
    const reader = streamReader(channel.streamCommits(store, 0));
    expect(await nextMessage(reader)).toMatchObject({ kind: 'commit', commit: { revision: 1 } });
    vi.advanceTimersByTime(15_000);
    expect(await nextMessage(reader)).toMatchObject({ kind: 'heartbeat', revision: 1 });
    await reader.cancel();
  });

  it('gives a restarted channel a distinct epoch even in the same millisecond while preserving replay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    const { store, canvas, channel } = await fixture();
    addNode(store, canvas.id);
    const originalReader = streamReader(channel.streamCommits(store, 0));
    const original = await nextMessage(originalReader);
    await originalReader.cancel();
    const restartedReader = streamReader(new CanvasChannel(canvas.id).streamCommits(store, 0));
    const restarted = await nextMessage(restartedReader);
    expect(restarted.epoch).not.toBe(original.epoch);
    expect(restarted).toMatchObject({ kind: 'commit', commit: { revision: 1 } });
    await restartedReader.cancel();
  });

  it('asks for a snapshot when the cursor precedes retention or is ahead of the document', async () => {
    const { store, canvas, channel } = await fixture();
    const node = addNode(store, canvas.id).node;
    for (let i = 0; i < 1_001; i += 1) store.updateNode(canvas.id, node.id, { x: i });
    for (const after of [0, 5_000]) {
      const reader = streamReader(channel.streamCommits(store, after));
      expect(await nextMessage(reader)).toMatchObject({ kind: 'resync', revision: 1_002 });
      await reader.cancel();
    }
  });

  it('asks for a snapshot when a migrated canvas has revisions without a journal', async () => {
    const { store, canvas, channel, handle } = await fixture();
    handle.raw.prepare('UPDATE canvases SET live_revision = 7 WHERE id = ?').run(canvas.id);
    const reader = streamReader(channel.streamCommits(store, 0));
    expect(await nextMessage(reader)).toMatchObject({ kind: 'resync', revision: 7 });
    await reader.cancel();
  });

  it('forwards cursor-neutral live activities and reports persisted revision in heartbeats', async () => {
    vi.useFakeTimers();
    const { store, canvas, channel } = await fixture();
    addNode(store, canvas.id);
    const reader = streamReader(channel.streamCommits(store, 1));
    // Even an unrelated legacy revision must never become a document cursor.
    channel.broadcast(900, { type: 'phase', label: 'generating' });
    channel.broadcast(900, { type: 'proposal_created', nodeIds: ['proposal'] });
    channel.broadcast(900, { type: 'graph_run', running: true, done: 0, total: 1 });
    expect(await nextMessage(reader)).toMatchObject({ kind: 'activity', event: { type: 'phase' } });
    expect(await nextMessage(reader)).toMatchObject({ kind: 'activity', event: { type: 'proposal_created' } });
    expect(await nextMessage(reader)).toMatchObject({ kind: 'activity', event: { type: 'graph_run' } });
    vi.advanceTimersByTime(15_000);
    expect(await nextMessage(reader)).toMatchObject({ kind: 'heartbeat', revision: 1 });
    await reader.cancel();
  });

  it('replays the latest active graph controls after durable replay on reconnect within the same process', async () => {
    vi.useFakeTimers();
    const { store, canvas, channel } = await fixture();
    addNode(store, canvas.id);
    channel.broadcast(1, { type: 'graph_run', running: true, done: 0, total: 3, operationId: 'run' });
    channel.broadcast(1, { type: 'graph_run', running: true, done: 1, total: 3, operationId: 'run' });
    const reader = streamReader(channel.streamCommits(store, 0));
    expect(await nextMessage(reader)).toMatchObject({ kind: 'commit', commit: { revision: 1 } });
    expect(await nextMessage(reader)).toMatchObject({
      kind: 'activity', event: { type: 'graph_run', running: true, done: 1, total: 3, operationId: 'run' },
    });
    await reader.cancel();

    const reconnected = streamReader(channel.streamCommits(store, 1));
    expect(await nextMessage(reconnected)).toMatchObject({ kind: 'activity', event: { type: 'graph_run', done: 1 } });
    await reconnected.cancel();

    // A new process/channel has no live run to resume, even with the same durable document.
    const restarted = streamReader(new CanvasChannel(canvas.id).streamCommits(store, 1));
    vi.advanceTimersByTime(15_000);
    expect(await nextMessage(restarted)).toMatchObject({ kind: 'heartbeat', revision: 1 });
    await restarted.cancel();
  });

  it('clears cached graph controls when the run terminates and never replays old phases or proposals', async () => {
    vi.useFakeTimers();
    const { store, channel } = await fixture();
    channel.broadcast(0, { type: 'graph_run', running: true, done: 0, total: 1 });
    channel.broadcast(0, { type: 'phase', label: 'generating' });
    channel.broadcast(0, { type: 'proposal_created', nodeIds: ['proposal'] });
    channel.broadcast(0, { type: 'graph_run', running: false, done: 0, total: 1, outcome: 'cancelled' });
    const reader = streamReader(channel.streamCommits(store, 0));
    vi.advanceTimersByTime(15_000);
    expect(await nextMessage(reader)).toMatchObject({ kind: 'heartbeat', revision: 0 });
    await reader.cancel();
  });

  it.each(['cancel', 'abort'] as const)('releases both observers and heartbeat on %s', async (exit) => {
    vi.useFakeTimers();
    const { store, channel } = await fixture();
    const releaseCommits = vi.fn();
    const releaseActivities = vi.fn();
    const commitSubscribe = store.subscribeCommits.bind(store);
    const activitySubscribe = channel.subscribe.bind(channel);
    vi.spyOn(store, 'subscribeCommits').mockImplementation((listener) => {
      const unsubscribe = commitSubscribe(listener);
      return () => { unsubscribe(); releaseCommits(); };
    });
    vi.spyOn(channel, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = activitySubscribe(listener);
      return () => { unsubscribe(); releaseActivities(); };
    });
    const abort = new AbortController();
    const reader = streamReader(channel.streamCommits(store, 0, abort.signal));
    expect(vi.getTimerCount()).toBe(1);
    if (exit === 'cancel') await reader.cancel();
    else {
      abort.abort();
      expect((await reader.read()).done).toBe(true);
    }
    expect(releaseCommits).toHaveBeenCalledTimes(1);
    expect(releaseActivities).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases resources and errors the stream when encoding a live message fails', async () => {
    vi.useFakeTimers();
    const { store, canvas, channel } = await fixture();
    let emit: (commit: CanvasCommit) => void;
    const unsubscribe = vi.fn();
    vi.spyOn(store, 'subscribeCommits').mockImplementation((listener) => {
      emit = listener;
      return unsubscribe;
    });
    const releaseActivities = vi.fn();
    const activitySubscribe = channel.subscribe.bind(channel);
    vi.spyOn(channel, 'subscribe').mockImplementation((listener) => {
      const dispose = activitySubscribe(listener);
      return () => { dispose(); releaseActivities(); };
    });
    const reader = streamReader(channel.streamCommits(store, 0));
    const cyclic = { canvasId: canvas.id, revision: 1, changes: [] } as CanvasCommit;
    cyclic.changes.push(cyclic as unknown as CanvasCommit['changes'][number]);
    emit(cyclic);
    await expect(reader.read()).rejects.toThrow('circular');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(releaseActivities).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the legacy document event subscription used by background job watchers', async () => {
    const { store, canvas, channel } = await fixture();
    const watcher = vi.fn();
    const unsubscribe = channel.subscribe(watcher);
    const reader = streamReader(channel.stream(0));
    const added = addNode(store, canvas.id);
    channel.broadcast(added.rev, { type: 'node_added', node: added.node });
    expect(watcher).toHaveBeenCalledWith(expect.objectContaining({ v: 1, event: { type: 'node_added', node: added.node } }));
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({ v: 1, rev: 1 });
    unsubscribe();
    await reader.cancel();
  });
});
