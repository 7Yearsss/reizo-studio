import { describe, expect, it } from 'vitest';
import { estimateNodeCost, estimateGraphCost } from './canvasPricing';
import type { CanvasNode, CanvasEdge } from './canvas';

describe('canvasPricing', () => {
  it('estimates node cost correctly across models and types', () => {
    expect(estimateNodeCost({ type: 'image', params: { model: 'flux-schnell' } })).toBe(1);
    expect(estimateNodeCost({ type: 'image', params: { model: 'flux-dev' } })).toBe(2);
    expect(estimateNodeCost({ type: 'image', params: { model: 'dall-e-3' } })).toBe(3);
    expect(estimateNodeCost({ type: 'video', params: { model: 'kling-v1', duration: '5s' } })).toBe(10);
    expect(estimateNodeCost({ type: 'video', params: { model: 'kling-v1', duration: '10s' } })).toBe(20);
    expect(estimateNodeCost({ type: 'video', params: { model: 'kling-pro', duration: '10s' } })).toBe(30);
    expect(estimateNodeCost({ type: 'video', params: { model: 'minimax', duration: '5s' } })).toBe(15);
    expect(estimateNodeCost({ type: 'agent' })).toBe(1);
    expect(estimateNodeCost({ type: 'note' })).toBe(0);
  });

  it('computes graph cost differentiating cached vs runnable nodes', () => {
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

    const estimate = estimateGraphCost(nodes, edges);
    expect(estimate.cachedCount).toBe(1);
    expect(estimate.runnableCount).toBe(1);
    expect(estimate.totalPoints).toBe(20); // 10s video = 20 pts
  });
});
