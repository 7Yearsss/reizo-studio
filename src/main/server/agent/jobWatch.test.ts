import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { stopCanvasWork } from '../canvas/workLifecycle';
const notify = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => vi.fn(() => true));
vi.mock('./session', () => ({ isSessionTurnLive: live }));
vi.mock('./steerInbox', () => ({ pushSteer: notify }));
import { watchCanvasNodeJob } from './jobWatch';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
beforeEach(() => { notify.mockClear(); live.mockReturnValue(true); });
async function fixture() {
  const handle = openDb(':memory:');
  const session = await createSqliteSessionStore(handle).create('s', null, null);
  const store = createCanvasStore(handle);
  let closed = false;
  const close = () => { stopCanvasWork(store); handle.close(); closed = true; };
  cleanup.push(() => { if (!closed) close(); });
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
  watchCanvasNodeJob(session.id, canvasId, store, [node.id]);
  return { store, canvasId, node, sessionId: session.id, close, channel: getCanvasChannel(canvasId) };
}
describe('background media completion notices', () => {
  it('handles image node_output completion and deduplicates its following node_updated event', async () => {
    const { store, canvasId, node, channel } = await fixture();
    const done = store.updateNode(canvasId, node.id, { runState: 'done', output: { assets: ['image.png'] } });
    channel.broadcast(done.rev, { type: 'node_output', id: node.id, output: done.node.output, runState: 'done' });
    channel.broadcast(done.rev, { type: 'node_updated', node: done.node });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1].content).toContain('后台任务完成');
  });
  it('drops a finished task notice when its turn is no longer live', async () => {
    const { node, channel } = await fixture();
    live.mockReturnValue(false);
    channel.broadcast(1, { type: 'run_state', id: node.id, runState: 'done' });
    expect(notify).not.toHaveBeenCalled();
  });
  it('deletion removes a watch before a late completion arrives', async () => {
    const { node, channel } = await fixture();
    channel.broadcast(1, { type: 'node_deleted', id: node.id });
    channel.broadcast(2, { type: 'node_output', id: node.id, output: { assets: ['late.png'] }, runState: 'done' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports the matched failed job even if its node now displays a successor result', async () => {
    const { store, canvasId, node, channel, sessionId } = await fixture();
    const first = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: { node: { title: 'Original job' } } });
    watchCanvasNodeJob(sessionId, canvasId, store, [node.id], first.id);
    store.jobs.finish(first.id, 'failed', { error: 'original provider failed' });
    const successor = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    store.jobs.finish(successor.id, 'succeeded', { result: { assets: ['successor.png'] } });
    const displayed = store.updateNode(canvasId, node.id, { runState: 'done', title: 'Successor job', output: { assets: ['successor.png'] } });
    channel.broadcast(displayed.rev, { type: 'node_updated', node: displayed.node });
    channel.broadcast(displayed.rev, { type: 'node_updated', node: displayed.node });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1].content).toContain('Original job');
    expect(notify.mock.calls[0][1].content).toContain('original provider failed');
    expect(notify.mock.calls[0][1].content).not.toContain('后台任务完成');
  });

  it('a successor running event settles the old cancelled watch without adopting the successor', async () => {
    const { store, canvasId, node, channel, sessionId } = await fixture();
    const first = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    watchCanvasNodeJob(sessionId, canvasId, store, [node.id], first.id);
    store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    channel.broadcast(1, { type: 'run_state', id: node.id, runState: 'running' });
    channel.broadcast(2, { type: 'node_output', id: node.id, output: { assets: ['new.png'] }, runState: 'done' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1].content).toContain('已被后续生成替换');
    expect(notify.mock.calls[0][1].content).not.toContain('后台任务完成');
  });

  it('a durable watch ignores unrelated terminal-looking projections while its own job is pending', async () => {
    const { store, canvasId, node, channel, sessionId } = await fixture();
    const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    watchCanvasNodeJob(sessionId, canvasId, store, [node.id], job.id);
    channel.broadcast(1, { type: 'run_state', id: node.id, runState: 'done' });
    expect(notify).not.toHaveBeenCalled();
    store.jobs.finish(job.id, 'succeeded', { result: { assets: ['own.png'] } });
    channel.broadcast(2, { type: 'node_output', id: node.id, output: { assets: ['own.png'] }, runState: 'done' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1].content).toContain('后台任务完成');
  });

  it('removes watches before database close and ignores late legacy publication', async () => {
    const { store, canvasId, node, channel, sessionId, close } = await fixture();
    const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: {} });
    watchCanvasNodeJob(sessionId, canvasId, store, [node.id], job.id);
    close();
    const read = vi.spyOn(store.jobs, 'get');
    channel.broadcast(1, { type: 'run_state', id: node.id, runState: 'done' });
    expect(read).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
