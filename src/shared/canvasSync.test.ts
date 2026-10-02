import { describe, expect, it } from 'vitest';
import { isCanvasCommit, isCanvasSyncMessage } from './canvasSync';

const base = { v: 2, canvasId: 'canvas', epoch: 'process' };
describe('canvas synchronization wire validation', () => {
  it('accepts complete document batches and transient activity', () => {
    expect(isCanvasSyncMessage({ ...base, kind: 'commit', commit: {
      canvasId: 'canvas', revision: 1, changes: [{ type: 'node_deleted', id: 'node' }],
    } })).toBe(true);
    expect(isCanvasSyncMessage({ ...base, kind: 'activity', event: { type: 'phase', label: 'generating' } })).toBe(true);
    expect(isCanvasSyncMessage({ ...base, kind: 'heartbeat', revision: 1 })).toBe(true);
  });
  it('rejects document events disguised as cursor-neutral activity and activity in a commit', () => {
    expect(isCanvasSyncMessage({ ...base, kind: 'activity', event: { type: 'node_deleted', id: 'node' } })).toBe(false);
    expect(isCanvasCommit({ canvasId: 'canvas', revision: 1, changes: [{ type: 'phase', label: 'hint' }] })).toBe(false);
    expect(isCanvasCommit({ canvasId: 'canvas', revision: 1, changes: [] })).toBe(false);
  });
  it('rejects invalid revisions, incomplete changes, and cross-canvas nodes', () => {
    for (const revision of [0, -1, 1.5, NaN, Infinity]) {
      expect(isCanvasCommit({ canvasId: 'canvas', revision, changes: [] })).toBe(false);
    }
    expect(isCanvasCommit({ canvasId: 'canvas', revision: 1, changes: [{ type: 'node_deleted' }] })).toBe(false);
    expect(isCanvasCommit({ canvasId: 'canvas', revision: 1, changes: [{ type: 'node_added', node: {
      id: 'node', canvasId: 'other', type: 'image', runState: 'idle', params: {},
    } }] })).toBe(false);
  });
});
