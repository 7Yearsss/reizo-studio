import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';
import { createCanvasStore } from './canvasStore';
import { createCanvasApplication } from '../canvas/application';
import { inputHash } from '../canvas/graph';
import type { CanvasCommit } from '../../../shared/canvasSync';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.restoreAllMocks(); });
const image = { type: 'image' as const, x: 0, y: 0, w: 100, h: 100, params: { prompt: 'product' } };
async function fixture() {
  const handle = openDb(':memory:');
  cleanup.push(() => handle.close());
  const session = await createSqliteSessionStore(handle).create('s', null, null);
  const store = createCanvasStore(handle);
  const canvas = store.ensureCanvas(session.id);
  return { handle, store, canvas, app: createCanvasApplication(store) };
}

describe('durable canvas transaction commits', () => {
  it('one outer transaction allocates one revision and journals the complete structure with mutation identity', async () => {
    const { store, canvas, app } = await fixture();
    app.batch(canvas.id, { kind: 'compound' }, () => {
      const source = app.addNode(canvas.id, image).node;
      const target = app.addNode(canvas.id, image).node;
      app.addEdge(canvas.id, { sourceId: source.id, targetId: target.id });
    });
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(1);
    const replay = store.readCommitsAfter(canvas.id, 0);
    expect(replay.resync).toBe(false);
    expect(replay.commits).toHaveLength(1);
    expect(replay.commits[0].changes.filter((change) => change.type === 'node_added')).toHaveLength(2);
    expect(replay.commits[0].changes.filter((change) => change.type === 'edge_added')).toHaveLength(1);
    app.addNode(canvas.id, image, 'receipt');
    expect(store.readCommitsAfter(canvas.id, 1).commits[0].mutationId).toBe('receipt');
    app.addNode(canvas.id, image, 'receipt');
    expect(store.readCommitsAfter(canvas.id, 1).commits).toHaveLength(1);
  });

  it('caught savepoint failure restores revision allocation, changes and dirty roots', async () => {
    const { store, canvas } = await fixture();
    store.transaction(() => {
      try {
        store.transaction(() => { store.addNode(canvas.id, image); throw new Error('rollback first write'); });
      } catch { /* continue the outer transaction */ }
      const source = store.addNode(canvas.id, image).node;
      try {
        store.transaction(() => {
          store.updateNode(canvas.id, source.id, { title: 'ghost update' });
          store.addNode(canvas.id, image);
          throw new Error('rollback sibling');
        });
      } catch { /* successful siblings still commit together */ }
      store.addNode(canvas.id, image);
    });
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(1);
    expect(store.getNodes(canvas.id)).toHaveLength(2);
    const replay = store.readCommitsAfter(canvas.id, 0);
    expect(replay.commits).toHaveLength(1);
    expect(replay.commits[0].changes.filter((change) => change.type === 'node_added')).toHaveLength(2);
    expect(JSON.stringify(replay.commits)).not.toContain('ghost update');
  });

  it('a failed outer transaction persists neither a revision nor a journal entry', async () => {
    const { store, canvas } = await fixture();
    expect(() => store.transaction(() => {
      store.addNode(canvas.id, image);
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(0);
    expect(store.readCommitsAfter(canvas.id, 0).commits).toEqual([]);
  });

  it('journal persistence failure rolls back the document and its idempotency receipt together', async () => {
    const { store, canvas, app, handle } = await fixture();
    handle.raw.exec("CREATE TRIGGER fail_commit BEFORE INSERT ON canvas_commits BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END");
    expect(() => app.addNode(canvas.id, image, 'failed-command')).toThrow('journal unavailable');
    expect(store.getNodes(canvas.id)).toEqual([]);
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(0);
    expect(store.getReceipt(canvas.id, 'failed-command')).toBeNull();
    expect(store.readCommitsAfter(canvas.id, 0).commits).toEqual([]);
  });

  it('journals derived dirty state after upstream output and reference edge changes', async () => {
    const { store, canvas } = await fixture();
    const source = store.addNode(canvas.id, image).node;
    const target = store.addNode(canvas.id, image).node;
    const edge = store.addEdge(canvas.id, { sourceId: source.id, targetId: target.id }).edge;
    store.updateNode(canvas.id, target.id, { paramsHash: inputHash(target, [source]), runState: 'done' });
    const before = store.getCanvas(canvas.id).liveRevision;
    store.updateNode(canvas.id, source.id, { output: { assets: ['new.png'] } });
    let changes = store.readCommitsAfter(canvas.id, before).commits[0].changes;
    expect(changes).toContainEqual(expect.objectContaining({ type: 'node_updated', node: expect.objectContaining({ id: target.id, dirty: true }) }));
    store.updateNode(canvas.id, target.id, { paramsHash: inputHash(target, [store.getNode(canvas.id, source.id)]) });
    const connected = store.getCanvas(canvas.id).liveRevision;
    store.deleteEdge(canvas.id, edge.id);
    changes = store.readCommitsAfter(canvas.id, connected).commits[0].changes;
    expect(changes).toContainEqual(expect.objectContaining({ type: 'node_updated', node: expect.objectContaining({ id: target.id, dirty: true }) }));
  });

  it('isolates observer errors and preserves revision order for reentrant writes', async () => {
    const { store, canvas } = await fixture();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const observed: CanvasCommit[] = [];
    const unsubscribe = store.subscribeCommits(() => { throw new Error('observer'); });
    store.subscribeCommits((commit) => {
      observed.push(commit);
      if (commit.revision === 1) store.addNode(canvas.id, image);
    });
    expect(() => store.addNode(canvas.id, image)).not.toThrow();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(observed.map((commit) => commit.revision)).toEqual([1, 2]);
    expect(store.getNodes(canvas.id)).toHaveLength(2);
    expect(store.readCommitsAfter(canvas.id, 0).commits).toHaveLength(2);
    unsubscribe();
  });

  it('requests resync for a journal hole or malformed stored payload', async () => {
    const { store, canvas, handle } = await fixture();
    const node = store.addNode(canvas.id, image).node;
    store.updateNode(canvas.id, node.id, { title: 'second' });
    store.updateNode(canvas.id, node.id, { title: 'third' });
    handle.raw.prepare('DELETE FROM canvas_commits WHERE canvas_id = ? AND revision = 2').run(canvas.id);
    expect(store.readCommitsAfter(canvas.id, 0).resync).toBe(true);
    handle.raw.prepare("UPDATE canvas_commits SET changes_json = '[{\"type\":\"node_deleted\"}]' WHERE canvas_id = ? AND revision = 3").run(canvas.id);
    expect(store.readCommitsAfter(canvas.id, 2).resync).toBe(true);
    handle.raw.prepare("UPDATE canvas_commits SET changes_json = '[]' WHERE canvas_id = ? AND revision = 3").run(canvas.id);
    expect(store.readCommitsAfter(canvas.id, 2).resync).toBe(true);
  });
});
