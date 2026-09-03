import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from './canvas';
import { nodeReadinessIssues } from './canvasReadiness';

function node(partial: Partial<CanvasNode> & { id: string; type: CanvasNode['type'] }): CanvasNode {
  return {
    canvasId: 'c1',
    x: 0,
    y: 0,
    w: 320,
    h: 380,
    title: '',
    params: {},
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: '',
    ...partial,
  } as CanvasNode;
}

describe('nodeReadinessIssues', () => {
  it('flags an empty image prompt', () => {
    const n = node({ id: 'a', type: 'image', params: { prompt: '  ' } });
    expect(nodeReadinessIssues(n, [], new Map())).toEqual(['提示词为空']);
  });

  it('is silent for a ready image node', () => {
    const n = node({ id: 'a', type: 'image', params: { prompt: 'a cat' } });
    expect(nodeReadinessIssues(n, [], new Map())).toEqual([]);
  });

  it('flags an @-mention whose target has no output', () => {
    const ref = node({ id: 'ref', type: 'image', title: '主角', output: { assets: [] } });
    const n = node({ id: 'a', type: 'image', params: { prompt: '画 @[主角](canvas:ref) 的特写' } });
    expect(nodeReadinessIssues(n, [], new Map([['ref', ref]]))).toEqual(['引用「主角」尚未生成画面']);
  });

  it('flags an @-mention whose target was deleted', () => {
    const n = node({ id: 'a', type: 'image', params: { prompt: '像 @[旧图](canvas:gone) 那样' } });
    expect(nodeReadinessIssues(n, [], new Map())).toEqual(['引用「旧图」的节点已被删除']);
  });

  it('accepts an @-mention whose target has an asset', () => {
    const ref = node({ id: 'ref', type: 'image', title: '主角', output: { assets: ['c1/x.png'] } });
    const n = node({ id: 'a', type: 'image', params: { prompt: '@[主角](canvas:ref) 奔跑' } });
    expect(nodeReadinessIssues(n, [], new Map([['ref', ref]]))).toEqual([]);
  });

  it('flags a video start-frame source with no output', () => {
    const src = node({ id: 'img', type: 'image', title: '首帧图', output: { assets: [] } });
    const vid = node({ id: 'v', type: 'video', params: { prompt: 'pan left' } });
    const edges: CanvasEdge[] = [
      { id: 'e', canvasId: 'c1', sourceId: 'img', sourceHandle: null, targetId: 'v', targetHandle: 'start_frame' },
    ];
    expect(nodeReadinessIssues(vid, edges, new Map([['img', src]]))).toEqual(['首帧来源「首帧图」尚未生成']);
  });

  it('flags an empty agent instruction', () => {
    const n = node({ id: 'a', type: 'agent', params: { instruction: '' } });
    expect(nodeReadinessIssues(n, [], new Map())).toEqual(['任务描述为空']);
  });

  it('never warns for group / note nodes', () => {
    expect(nodeReadinessIssues(node({ id: 'g', type: 'group', params: { memberIds: [] } }), [], new Map())).toEqual([]);
    expect(nodeReadinessIssues(node({ id: 'n', type: 'note', params: { content: '' } }), [], new Map())).toEqual([]);
  });
});
