import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createSessionsRouter } from './sessions';
import { createCanvasApplication } from '../canvas/application';
import { startVideoNode } from '../canvas/videoExecutor';
import { cancelVideoJobsForCanvas, getActiveJob, stopVideoJobsForStore } from '../canvas/asyncJobManager';
import { stopCanvasWork } from '../canvas/workLifecycle';
import { mockDriver } from '../canvas/videoDrivers';
import { runGraph, stopCanvasRun } from '../canvas/graphExecutor';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.restoreAllMocks(); });
const settingsStore = { get: async () => ({ providers: {} }) } as unknown as SettingsStore;

async function fixture(sharedIds = false) {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('delete-session', null, null);
  const store = createCanvasStore(handle);
  let canvasId = store.ensureCanvas(session.id).id;
  if (sharedIds) {
    handle.raw.prepare('UPDATE canvases SET id = ? WHERE id = ?').run('same-canvas', canvasId);
    canvasId = 'same-canvas';
  }
  let node = store.addNode(canvasId, { type: 'video', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'mock video', provider: 'mock' } }).node;
  if (sharedIds) {
    handle.raw.prepare('UPDATE canvas_nodes SET id = ? WHERE id = ?').run('same-node', node.id);
    node = store.getNode(canvasId, 'same-node');
  }
  cleanup.push(() => { stopVideoJobsForStore(store); stopCanvasWork(store); handle.close(); });
  const start = () => startVideoNode({ canvasStore: store, settingsStore, dataRoot: '.', canvasId, node });
  return { handle, sessions, session, store, canvasId, node, start };
}

describe('session removal execution cleanup', () => {
  it('captures removal effects before SQL cascade and executes them only after the session is gone', async () => {
    const { sessions, session, store, canvasId } = await fixture();
    const afterRemove = vi.fn(() => expect(store.getCanvas(canvasId)).toBeNull());
    const prepare = vi.fn((id: string) => {
      expect(id).toBe(session.id);
      expect(store.findCanvasBySession(id)?.id).toBe(canvasId);
      return afterRemove;
    });
    const app = new Hono().route('/api/sessions', createSessionsRouter(sessions, undefined, prepare));
    expect((await app.request(`/api/sessions/${session.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(afterRemove).toHaveBeenCalledTimes(1);
  });

  it('a failed SQL removal leaves existing video jobs active', async () => {
    vi.spyOn(mockDriver, 'submit').mockResolvedValue({ taskId: 'fake-remote-task' });
    const { sessions, session, store, canvasId, node, start } = await fixture();
    const accepted = start();
    await accepted.submitted;
    const cancel = vi.fn(() => cancelVideoJobsForCanvas(store, canvasId));
    vi.spyOn(sessions, 'remove').mockRejectedValue(new Error('Delete failed'));
    const app = new Hono().route('/api/sessions', createSessionsRouter(sessions, undefined, () => cancel));
    app.onError((_error, c) => c.json({ error: 'Delete failed' }, 500));
    expect((await app.request(`/api/sessions/${session.id}`, { method: 'DELETE' })).status).toBe(500);
    expect(cancel).not.toHaveBeenCalled();
    expect(store.jobs.get(accepted.job.id)?.status).toBe('running');
    expect(getActiveJob(canvasId, node.id, store)?.signal.aborted).toBe(false);
  });

  it('Application node deletion cancels only its own repository when canvas/node IDs match', async () => {
    vi.spyOn(mockDriver, 'submit').mockResolvedValue({ taskId: 'fake-remote-task' });
    const first = await fixture(true);
    const second = await fixture(true);
    const oldJob = first.start();
    const otherJob = second.start();
    await Promise.all([oldJob.submitted, otherJob.submitted]);
    createCanvasApplication(first.store).deleteNode(first.canvasId, first.node.id);
    await oldJob.completion;
    expect(first.store.jobs.get(oldJob.job.id)?.status).toBe('cancelled');
    expect(second.store.jobs.get(otherJob.job.id)?.status).toBe('running');
    expect(getActiveJob(first.canvasId, first.node.id, first.store)).toBeUndefined();
    expect(getActiveJob(second.canvasId, second.node.id, second.store)?.signal.aborted).toBe(false);
  });

  it('session deletion detaches its removed-ledger video while an identical foreign canvas keeps running', async () => {
    vi.spyOn(mockDriver, 'submit').mockResolvedValue({ taskId: 'fake-remote-task' });
    const first = await fixture(true);
    const second = await fixture(true);
    const firstJob = first.start();
    const secondJob = second.start();
    await Promise.all([firstJob.submitted, secondJob.submitted]);
    const app = new Hono().route('/api/sessions', createSessionsRouter(first.sessions, undefined, (sessionId) => {
      const id = first.store.findCanvasBySession(sessionId)?.id;
      return () => { if (id) cancelVideoJobsForCanvas(first.store, id); };
    }));
    expect((await app.request(`/api/sessions/${first.session.id}`, { method: 'DELETE' })).status).toBe(204);
    await firstJob.completion;
    expect(first.store.jobs.get(firstJob.job.id)).toBeNull();
    expect(getActiveJob(first.canvasId, first.node.id, first.store)).toBeUndefined();
    expect(second.store.jobs.get(secondJob.job.id)?.status).toBe('running');
    expect(getActiveJob(second.canvasId, second.node.id, second.store)?.signal.aborted).toBe(false);
  });

  it('canvas stop cancels a manual video without requiring an active graph', async () => {
    vi.spyOn(mockDriver, 'submit').mockResolvedValue({ taskId: 'fake-remote-task' });
    const { store, canvasId, start } = await fixture();
    const accepted = start();
    await accepted.submitted;
    expect(stopCanvasRun(canvasId, store)).toBe(true);
    await accepted.completion;
    expect(store.jobs.get(accepted.job.id)?.status).toBe('cancelled');
  });

  it('an explicit repository stop never aborts a foreign graph sharing its canvas ID', async () => {
    vi.spyOn(mockDriver, 'submit').mockResolvedValue({ taskId: 'fake-remote-task' });
    const first = await fixture(true);
    const second = await fixture(true);
    const graph = runGraph({ canvasStore: second.store, settingsStore, dataRoot: '.', canvasId: second.canvasId });
    await vi.waitFor(() => expect(getActiveJob(second.canvasId, second.node.id, second.store)?.taskId).toBe('fake-remote-task'));
    expect(stopCanvasRun(first.canvasId, first.store)).toBe(false);
    expect(getActiveJob(second.canvasId, second.node.id, second.store)?.signal.aborted).toBe(false);
    stopCanvasRun(second.canvasId, second.store);
    await graph;
  });
});
