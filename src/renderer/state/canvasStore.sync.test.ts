import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode, CanvasSnapshot } from '../../shared/canvas';
import type { CanvasSyncMessage } from '../../shared/canvasSync';

const harness = vi.hoisted(() => ({
  active: 's1',
  tabListeners: new Set<() => void>(),
  streams: [] as Array<{ canvasId: string; after: number; signal: AbortSignal; emit: (message: CanvasSyncMessage) => void; end: () => void }>,
}));

vi.mock('./tabStore', () => ({ activeSessionId: () => harness.active, subscribe: (listener: () => void) => { harness.tabListeners.add(listener); return () => harness.tabListeners.delete(listener); } }));
vi.mock('./settingsStore', () => ({ getSnapshot: () => ({ settings: {} }) }));
vi.mock('../lib/notify', () => ({ primeNotifications: vi.fn(), notifyJobDone: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: { info: vi.fn() } }));
vi.mock('../api', () => ({
  getCanvas: vi.fn(),
  addCanvasNode: vi.fn(),
  addCanvasEdge: vi.fn(),
  patchCanvasNode: vi.fn(),
  deleteCanvasNode: vi.fn(),
  setCanvasNodeAsset: vi.fn(),
  readCanvasSyncStream: vi.fn((canvasId: string, after: number, onMessage: (message: CanvasSyncMessage) => void, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    harness.streams.push({ canvasId, after, signal, emit: (message) => { try { onMessage(message); } catch (error) { reject(error); } }, end: resolve });
    signal.addEventListener('abort', () => resolve(), { once: true });
  })),
}));

import * as api from '../api';
import { notifyJobDone } from '../lib/notify';

let store: typeof import('./canvasStore');

function node(id: string, canvasId = 'c1'): CanvasNode {
  return { id, canvasId, type: 'image', x: 0, y: 0, w: 320, h: 380, title: id, params: {}, paramsHash: null, runState: 'idle', output: null, updatedAt: '' };
}
function edge(id: string, sourceId: string, targetId: string): CanvasEdge {
  return { id, canvasId: 'c1', sourceId, targetId, sourceHandle: null, targetHandle: null };
}
function snapshot(revision = 1, nodes = [node('a'), node('b')], edges = [edge('old', 'a', 'b')], canvasId = 'c1', sessionId = 's1'): CanvasSnapshot {
  return { canvas: { id: canvasId, sessionId, liveRevision: revision, createdAt: '', updatedAt: '' }, nodes, edges };
}
function commit(revision: number, changes: Extract<CanvasSyncMessage, { kind: 'commit' }>['commit']['changes'], epoch = 'e1'): CanvasSyncMessage {
  return { v: 2, canvasId: 'c1', epoch, kind: 'commit', commit: { canvasId: 'c1', revision, changes } };
}
function switchTo(sessionId: string) { harness.active = sessionId; harness.tabListeners.forEach((listener) => listener()); }
async function settle() { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.active = 's1';
  harness.tabListeners.clear();
  harness.streams.length = 0;
  vi.mocked(api.getCanvas).mockResolvedValue(snapshot());
  store = await import('./canvasStore');
});

afterEach(async () => {
  store.closeCanvas('s1');
  store.closeCanvas('s2');
  vi.useRealTimers();
  await settle();
});

describe('canvas store commit synchronization', () => {
  it('preserves live drag and resize geometry when a provider commits a full result row', async () => {
    await store.openCanvas('s1');
    store.moveNodesGeometryLive('s1', new Map([['a', { x: 150, y: 160, w: 500, h: 550 }]]));
    harness.streams[0].emit(commit(2, [{ type: 'node_updated', node: { ...node('a'), runState: 'done', output: { assets: ['c1/done.png'] } } }]));
    expect(store.nodeById('s1', 'a')).toMatchObject({ x: 150, y: 160, w: 500, h: 550, runState: 'done', output: { assets: ['c1/done.png'] } });
    expect(api.patchCanvasNode).not.toHaveBeenCalled();
  });

  it('keeps pending parameters over provider output, then releases them on the matching durable acknowledgement', async () => {
    await store.openCanvas('s1');
    let resolvePatch!: (value: CanvasNode) => void;
    vi.mocked(api.patchCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const updating = store.updateNodeParams('s1', 'a', { prompt: 'local' });
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const mutationId = vi.mocked(api.patchCanvasNode).mock.calls[0][3];
    const finished = { ...node('a'), runState: 'done' as const, output: { assets: ['c1/done.png'] } };
    harness.streams[0].emit(commit(2, [{ type: 'node_updated', node: finished }]));
    expect(store.nodeById('s1', 'a')).toMatchObject({ params: { prompt: 'local' }, output: finished.output });
    const saved = { ...finished, params: { prompt: 'local' } };
    harness.streams[0].emit({ ...commit(3, [{ type: 'node_updated', node: saved }]), kind: 'commit', commit: { canvasId: 'c1', revision: 3, mutationId, changes: [{ type: 'node_updated', node: saved }] } });
    resolvePatch(saved);
    await updating;
    harness.streams[0].emit(commit(4, [{ type: 'node_updated', node: { ...saved, params: { prompt: 'remote' } } }]));
    expect(store.nodeById('s1', 'a')?.params).toEqual({ prompt: 'remote' });
  });

  it('an older patch acknowledgement cannot release a newer resize gesture', async () => {
    await store.openCanvas('s1');
    let resolvePatch!: (value: CanvasNode) => void;
    vi.mocked(api.patchCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const resizing = store.resizeNode('s1', 'a', 400, 450);
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const mutationId = vi.mocked(api.patchCanvasNode).mock.calls[0][3];
    store.moveNodesGeometryLive('s1', new Map([['a', { w: 500, h: 550 }]]));
    const old = { ...node('a'), w: 400, h: 450 };
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'commit', commit: { canvasId: 'c1', revision: 2, mutationId, changes: [{ type: 'node_updated', node: old }] } });
    resolvePatch(old);
    await resizing;
    harness.streams[0].emit(commit(3, [{ type: 'node_updated', node: { ...old, output: { assets: ['c1/done.png'] } } }]));
    expect(store.nodeById('s1', 'a')).toMatchObject({ w: 500, h: 550, output: { assets: ['c1/done.png'] } });
  });

  it('sends overlapping writes to the same node in order while projecting the latest intent immediately', async () => {
    await store.openCanvas('s1');
    const responses: Array<(value: CanvasNode) => void> = [];
    vi.mocked(api.patchCanvasNode).mockImplementation(() => new Promise((resolve) => { responses.push(resolve); }));
    const first = store.renameNode('s1', 'a', 'first');
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const latest = store.renameNode('s1', 'a', 'latest');
    expect(store.nodeById('s1', 'a')?.title).toBe('latest');
    expect(api.patchCanvasNode).toHaveBeenCalledTimes(1);
    const firstId = vi.mocked(api.patchCanvasNode).mock.calls[0][3];
    const firstRow = { ...node('a'), title: 'first' };
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'commit', commit: { canvasId: 'c1', revision: 2, mutationId: firstId, changes: [{ type: 'node_updated', node: firstRow }] } });
    responses[0](firstRow);
    await first;
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(2));
    expect(store.nodeById('s1', 'a')?.title).toBe('latest');
    const latestId = vi.mocked(api.patchCanvasNode).mock.calls[1][3];
    const latestRow = { ...node('a'), title: 'latest' };
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'commit', commit: { canvasId: 'c1', revision: 3, mutationId: latestId, changes: [{ type: 'node_updated', node: latestRow }] } });
    responses[1](latestRow);
    await latest;
    expect(store.nodeById('s1', 'a')?.title).toBe('latest');
    expect(api.getCanvas).toHaveBeenCalledTimes(1);
  });

  it('rolls back rejected fields to current authority while retaining completed provider output', async () => {
    await store.openCanvas('s1');
    let rejectPatch!: (error: Error) => void;
    vi.mocked(api.patchCanvasNode).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPatch = reject; }));
    const resizing = store.resizeNode('s1', 'a', 500, 550);
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const authority = { ...node('a'), runState: 'done' as const, output: { assets: ['c1/done.png'] } };
    harness.streams[0].emit(commit(2, [{ type: 'node_updated', node: authority }]));
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(2, [authority, node('b')], []));
    rejectPatch(new Error('Rejected'));
    await resizing;
    expect(store.nodeById('s1', 'a')).toMatchObject({ w: 320, h: 380, runState: 'done', output: authority.output });
  });

  it('a missed mutation acknowledgement cannot mask newer authority when the post-ack snapshot arrives stale', async () => {
    await store.openCanvas('s1');
    let resolvePatch!: (value: CanvasNode) => void;
    let resolveSnapshot!: (value: CanvasSnapshot) => void;
    vi.mocked(api.patchCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const updating = store.renameNode('s1', 'a', 'accepted');
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const accepted = { ...node('a'), title: 'accepted' };
    harness.streams[0].emit(commit(2, [{ type: 'node_updated', node: accepted }]));
    harness.streams[0].emit(commit(3, [{ type: 'node_updated', node: { ...node('a'), title: 'remote' } }]));
    vi.mocked(api.getCanvas).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    resolvePatch(accepted);
    await vi.waitFor(() => expect(api.getCanvas).toHaveBeenCalledTimes(2));
    harness.streams[0].emit(commit(4, [{ type: 'node_updated', node: { ...node('a'), title: 'newest' } }]));
    resolveSnapshot(snapshot(3, [{ ...node('a'), title: 'remote' }, node('b')], []));
    await updating;
    expect(store.nodeById('s1', 'a')?.title).toBe('newest');
  });

  it('an inactive delayed patch response cannot overwrite a newer authoritative snapshot', async () => {
    switchTo('s2');
    await store.openCanvas('s1');
    let resolvePatch!: (value: CanvasNode) => void;
    vi.mocked(api.patchCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const updating = store.renameNode('s1', 'a', 'accepted');
    await vi.waitFor(() => expect(api.patchCanvasNode).toHaveBeenCalledTimes(1));
    const remote = { ...node('a'), title: 'remote' };
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(3, [remote, node('b')], []));
    await store.openCanvas('s1');
    resolvePatch({ ...node('a'), title: 'accepted' });
    await updating;
    expect(store.nodeById('s1', 'a')?.title).toBe('remote');
    expect(harness.streams).toHaveLength(0);
  });

  it('ending a resize or multi-node drag at its original geometry releases live ownership', async () => {
    await store.openCanvas('s1');
    store.moveNodesGeometryLive('s1', new Map([['a', { x: 100, y: 120, w: 500, h: 550 }], ['b', { x: 200, y: 220 }]]));
    store.commitResize('s1', 'a', { x: 0, y: 0, w: 320, h: 380 }, { x: 0, y: 0, w: 320, h: 380 });
    store.commitMoveBatch('s1', [{ id: 'b', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }]);
    harness.streams[0].emit(commit(2, [{ type: 'node_updated', node: { ...node('a'), w: 600 } }, { type: 'node_updated', node: { ...node('b'), x: 300 } }]));
    expect(store.nodeById('s1', 'a')?.w).toBe(600);
    expect(store.nodeById('s1', 'b')?.x).toBe(300);
    expect(api.patchCanvasNode).not.toHaveBeenCalled();
  });

  it('notifies once for an entire transaction and ignores duplicate commits', async () => {
    await store.openCanvas('s1');
    const before = store.getSnapshot();
    const updates: Array<ReturnType<typeof store.getSnapshot>> = [];
    const unsubscribe = store.subscribe(() => updates.push(store.getSnapshot()));
    const message = commit(2, [{ type: 'node_deleted', id: 'a' }, { type: 'node_added', node: node('new') }, { type: 'edge_added', edge: edge('new-edge', 'new', 'b') }]);
    harness.streams[0].emit(message);
    harness.streams[0].emit(message);
    expect(updates).toHaveLength(1);
    expect(updates[0].nodesBySession.s1.map((item) => item.id)).toEqual(['b', 'new']);
    expect(updates[0].edgesBySession.s1.map((item) => item.id)).toEqual(['new-edge']);
    expect(updates[0].nodesBySession.s1[0]).toBe(before.nodesBySession.s1[1]);
    unsubscribe();
  });

  it('refreshes a snapshot on a gap, then resumes from the snapshot cursor', async () => {
    await store.openCanvas('s1');
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(9, [node('fresh')], []));
    harness.streams[0].emit(commit(4, [{ type: 'node_added', node: node('partial') }]));
    await vi.waitFor(() => expect(harness.streams).toHaveLength(2));
    expect(store.getSnapshot().nodesBySession.s1.map((item) => item.id)).toEqual(['fresh']);
    expect(harness.streams[1].after).toBe(9);
    harness.streams[1].emit(commit(10, [{ type: 'node_added', node: node('next') }]));
    expect(store.nodeById('s1', 'next')).toBeDefined();
  });

  it('notifies once for a terminal transition expressed as authoritative row updates', async () => {
    const running = { ...node('a'), runState: 'running' as const };
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(1, [running], []));
    await store.openCanvas('s1');
    harness.streams[0].emit(commit(2, [
      { type: 'node_updated', node: { ...running, runState: 'done', output: { assets: ['c1/done.png'] } } },
      { type: 'node_updated', node: { ...running, runState: 'done', output: { assets: ['c1/done.png'], progress: 100 } } },
    ]));
    expect(notifyJobDone).toHaveBeenCalledTimes(1);
    expect(notifyJobDone).toHaveBeenCalledWith('生成完成', '「a」已就绪');
  });

  it('clears stale graph activity and refreshes on a changed server epoch', async () => {
    await store.openCanvas('s1');
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'activity', event: { type: 'graph_run', running: true, done: 0, total: 2 } });
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'activity', event: { type: 'phase', label: 'Planning' } });
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(3, [node('restarted')], []));
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e2', kind: 'heartbeat', revision: 3 });
    await vi.waitFor(() => expect(harness.streams).toHaveLength(2));
    expect(store.nodeById('s1', 'restarted')).toBeDefined();
    expect(store.getSnapshot().graphRunBySession.s1).toBeUndefined();
    expect(store.getSnapshot().phaseBySession.s1).toBeUndefined();
    expect(harness.streams[1].after).toBe(3);
  });

  it('keeps heartbeats and activity off the document cursor', async () => {
    await store.openCanvas('s1');
    const stream = harness.streams[0];
    stream.emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'heartbeat', revision: 1 });
    stream.emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'activity', event: { type: 'graph_run', running: true, done: 0, total: 2 } });
    stream.emit(commit(2, [{ type: 'node_added', node: node('next') }]));
    expect(store.nodeById('s1', 'next')).toBeDefined();
    expect(api.getCanvas).toHaveBeenCalledTimes(1);
  });

  it('reconnects from the last complete commit without replacing the document with a snapshot', async () => {
    await store.openCanvas('s1');
    harness.streams[0].emit(commit(2, [{ type: 'node_added', node: node('next') }]));
    vi.useFakeTimers();
    harness.streams[0].end();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[1].after).toBe(2);
    expect(api.getCanvas).toHaveBeenCalledTimes(1);
    expect(store.nodeById('s1', 'next')).toBeDefined();
  });

  it('rejects callbacks from an aborted stream after switching away and back', async () => {
    await store.openCanvas('s1');
    const old = harness.streams[0];
    switchTo('s2');
    expect(old.signal.aborted).toBe(true);
    switchTo('s1');
    await vi.waitFor(() => expect(harness.streams).toHaveLength(2));
    old.emit(commit(2, [{ type: 'node_added', node: node('late') }]));
    harness.streams[1].emit(commit(2, [{ type: 'node_added', node: node('owned') }]));
    expect(store.nodeById('s1', 'late')).toBeUndefined();
    expect(store.nodeById('s1', 'owned')).toBeDefined();
    const foreign: CanvasSyncMessage = { v: 2, canvasId: 'foreign', epoch: 'other', kind: 'resync', revision: 20 };
    harness.streams[1].emit(foreign);
    await settle();
    expect(api.getCanvas).toHaveBeenCalledTimes(2);
  });

  it('never ingests an aborted activation snapshot, including after the session is reopened', async () => {
    let resolveOld!: (value: CanvasSnapshot) => void;
    vi.mocked(api.getCanvas).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const opening = store.openCanvas('s1');
    switchTo('s2');
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(4, [node('current')], []));
    switchTo('s1');
    await vi.waitFor(() => expect(harness.streams).toHaveLength(1));
    resolveOld(snapshot(1, [node('stale')], []));
    await opening;
    expect(store.nodeById('s1', 'current')).toBeDefined();
    expect(store.nodeById('s1', 'stale')).toBeUndefined();
    expect(harness.streams[0].after).toBe(4);
  });

  it('does not resurrect a node when its add response arrives after stream deletion', async () => {
    await store.openCanvas('s1');
    let resolveAdd!: (value: CanvasNode) => void;
    vi.mocked(api.addCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolveAdd = resolve; }));
    const adding = store.addNode('s1', 'image', { x: 0, y: 0 });
    harness.streams[0].emit(commit(2, [{ type: 'node_added', node: node('delayed') }]));
    harness.streams[0].emit(commit(3, [{ type: 'node_deleted', id: 'delayed' }]));
    resolveAdd(node('delayed'));
    await adding;
    expect(store.nodeById('s1', 'delayed')).toBeUndefined();
  });

  it('does not overwrite a newer output with a delayed upload response', async () => {
    await store.openCanvas('s1');
    let resolveUpload!: (value: CanvasNode) => void;
    vi.mocked(api.setCanvasNodeAsset).mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
    const uploading = store.uploadAssetToNode('s1', 'a', new File(['image'], 'image.png'));
    await vi.waitFor(() => expect(api.setCanvasNodeAsset).toHaveBeenCalledTimes(1));
    harness.streams[0].emit(commit(2, [{ type: 'node_output', id: 'a', runState: 'done', output: { assets: ['c1/new.png'] } }]));
    resolveUpload({ ...node('a'), output: { assets: ['c1/old.png'] } });
    await uploading;
    expect(store.nodeById('s1', 'a')?.output?.assets).toEqual(['c1/new.png']);
  });

  it('ignores a late resync snapshot after the stream loses ownership', async () => {
    await store.openCanvas('s1');
    let resolveSnapshot!: (value: CanvasSnapshot) => void;
    vi.mocked(api.getCanvas).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    harness.streams[0].emit({ v: 2, canvasId: 'c1', epoch: 'e1', kind: 'resync', revision: 10 });
    await vi.waitFor(() => expect(api.getCanvas).toHaveBeenCalledTimes(2));
    switchTo('s2');
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(3, [node('owned')], []));
    switchTo('s1');
    await vi.waitFor(() => expect(harness.streams).toHaveLength(2));
    resolveSnapshot(snapshot(99, [node('late')], []));
    await settle();
    expect(store.nodeById('s1', 'owned')).toBeDefined();
    expect(store.nodeById('s1', 'late')).toBeUndefined();
  });

  it('refreshes an inactive canvas when a local delete fences a delayed response', async () => {
    switchTo('s2');
    await store.openCanvas('s1');
    let resolveAdd!: (value: CanvasNode) => void;
    vi.mocked(api.addCanvasNode).mockImplementationOnce(() => new Promise((resolve) => { resolveAdd = resolve; }));
    vi.mocked(api.deleteCanvasNode).mockResolvedValue(undefined);
    const adding = store.addNode('s1', 'image', { x: 0, y: 0 });
    await store.removeNode('s1', 'a');
    vi.mocked(api.getCanvas).mockResolvedValue(snapshot(3, [node('b'), node('added')], []));
    resolveAdd(node('added'));
    await adding;
    expect(api.getCanvas).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().nodesBySession.s1.map((item) => item.id)).toEqual(['b', 'added']);
    expect(harness.streams).toHaveLength(0);
  });
});
