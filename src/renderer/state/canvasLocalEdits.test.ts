import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../shared/canvas';
import { CanvasLocalEdits } from './canvasLocalEdits';

const node: CanvasNode = { id: 'a', canvasId: 'c1', type: 'image', x: 0, y: 0, w: 320, h: 380, title: 'original', params: { prompt: 'original' }, paramsHash: null, runState: 'running', output: null, updatedAt: '' };

describe('canvas local field ownership', () => {
  it('merges a provider result under live geometry and preserves untouched references', () => {
    const edits = new CanvasLocalEdits();
    edits.stage(node, { x: 100, y: 120, w: 500, h: 550 });
    const completed = { ...node, runState: 'done' as const, output: { assets: ['c1/done.png'] } };
    edits.receiveChanges([{ type: 'node_updated', node: completed }]);
    const untouched = { ...node, id: 'b' };
    const projected = edits.project([completed, untouched]);
    expect(projected[0]).toMatchObject({ x: 100, y: 120, w: 500, h: 550, output: completed.output, runState: 'done' });
    expect(projected[1]).toBe(untouched);
    expect(edits.discardLive('a')).toMatchObject({ x: 0, w: 320, output: completed.output, runState: 'done' });
  });

  it('a stale request commit, ack or failure cannot release the latest field owner', () => {
    const edits = new CanvasLocalEdits();
    edits.stage(node, { title: 'first' }, 'first');
    edits.stage({ ...node, title: 'first' }, { title: 'latest' }, 'latest');
    const first = { ...node, title: 'first' };
    edits.receiveChanges([{ type: 'node_updated', node: first }], 'first');
    expect(edits.acknowledge('a', 'c1', 'first', first, false)).toBeUndefined();
    expect(edits.fail('a', 'c1', 'first')).toBeUndefined();
    expect(edits.project([first])[0].title).toBe('latest');
    const latest = { ...node, title: 'latest' };
    edits.receiveChanges([{ type: 'node_updated', node: latest }], 'latest');
    expect(edits.hasOwner('a', 'latest')).toBe(false);
    const later = { ...node, title: 'remote' };
    expect(edits.project([later])[0]).toBe(later);
  });

  it('only a snapshot started after acknowledgement releases a missed receipt, including later remote edits', () => {
    const edits = new CanvasLocalEdits();
    edits.stage(node, { title: 'accepted' }, 'local');
    const beforeAck = edits.acknowledgedVersion;
    edits.acknowledge('a', 'c1', 'local', { ...node, title: 'accepted' }, true);
    const remote = { ...node, title: 'remote' };
    edits.receiveSnapshot('c1', [remote], beforeAck);
    expect(edits.project([remote])[0].title).toBe('accepted');
    edits.receiveSnapshot('c1', [remote], edits.acknowledgedVersion);
    expect(edits.project([remote])[0]).toBe(remote);
  });

  it('stale snapshots can confirm acceptance against newer authority without replacing it', () => {
    const edits = new CanvasLocalEdits();
    edits.stage(node, { title: 'accepted' }, 'local');
    edits.acknowledge('a', 'c1', 'local', { ...node, title: 'accepted' }, true);
    const newest = { ...node, title: 'newest', output: { assets: ['c1/newest.png'] } };
    edits.receiveChanges([{ type: 'node_updated', node: newest }]);
    const confirmed = edits.confirmAcknowledgements(edits.acknowledgedVersion);
    expect(confirmed.get('a')).toEqual(newest);
    expect(edits.hasOwner('a', 'local')).toBe(false);
  });

  it('rollback restores latest authority and leaves an independent live field intact', () => {
    const edits = new CanvasLocalEdits();
    edits.stage(node, { title: 'rejected' }, 'write');
    edits.stage({ ...node, title: 'rejected' }, { x: 100 });
    const completed = { ...node, runState: 'done' as const, output: { assets: ['c1/done.png'] } };
    edits.receiveChanges([{ type: 'node_updated', node: completed }]);
    expect(edits.fail('a', 'c1', 'write')).toMatchObject({ title: 'original', x: 100, runState: 'done', output: completed.output });
    expect(edits.discardLive('a')).toEqual(completed);
  });
});
