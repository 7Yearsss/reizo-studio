import { describe, expect, it } from 'vitest';
import { summarizeGraphRuns } from './canvasExecution';
import type { CanvasNode, CanvasEdge } from './canvas';

describe('canvasExecution', () => {
  it('distinguishes cached and pending nodes without a local point estimate', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'n1',
        canvasId: 'c1',
        type: 'image',
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        title: 'Cached Node',
        runState: 'done',
        output: { assets: ['asset-1'] },
        params: { prompt: 'A sunny beach', size: '1024x1024' },
        paramsHash: JSON.stringify({ params: { prompt: 'A sunny beach', size: '1024x1024' }, up: [] }),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'n2',
        canvasId: 'c1',
        type: 'video',
        x: 400,
        y: 0,
        w: 300,
        h: 200,
        title: 'Dirty Video Node',
        runState: 'idle',
        output: null,
        params: { prompt: 'Waves rolling in', duration: '10s' },
        paramsHash: null,
        updatedAt: new Date().toISOString(),
      },
    ];

    const edges: CanvasEdge[] = [
      { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', sourceHandle: null, targetHandle: null },
    ];

    const estimate = summarizeGraphRuns(nodes, edges);
    expect(estimate.cachedCount).toBe(1);
    expect(estimate.runnableCount).toBe(1);
    expect(estimate).not.toHaveProperty('totalPoints');
  });

  it('does not count uploaded image nodes as runnable', () => {
    const upload = {
      id: 'u', canvasId: 'c', type: 'image', x: 0, y: 0, w: 1, h: 1, title: '',
      params: {}, paramsHash: null, runState: 'done', output: { assets: ['u.png'] }, updatedAt: '',
    } as unknown as CanvasNode;
    const estimate = summarizeGraphRuns([upload], []);
    expect(estimate.runnableCount).toBe(0);
    expect(estimate.cachedCount).toBe(0);
  });
});
