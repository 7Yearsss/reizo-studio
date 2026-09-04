import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from './canvas';
import { extractSubgraph, formatSubgraphForPrompt } from './canvasSubgraph';

function makeNode(partial: Partial<CanvasNode> & { id: string; type: CanvasNode['type'] }): CanvasNode {
  return {
    canvasId: 'c1',
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    title: '',
    params: {},
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: '',
    ...partial,
  } as CanvasNode;
}

describe('canvasSubgraph', () => {
  const n1 = makeNode({ id: 'n1', type: 'image', title: '概念图', params: { prompt: '赛博朋克雨夜' }, runState: 'done' });
  const n2 = makeNode({ id: 'n2', type: 'video', title: '镜头一', params: { prompt: '主角转身', model: 'kling-1.5' }, runState: 'idle' });
  const n3 = makeNode({ id: 'n3', type: 'note', title: '编剧便签', params: { content: '注意冷色调' } });
  const external = makeNode({ id: 'ext', type: 'image', title: '上游参考' });

  const edges: CanvasEdge[] = [
    { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', sourceHandle: null, targetHandle: 'start_frame' },
    { id: 'e2', canvasId: 'c1', sourceId: 'ext', targetId: 'n1', sourceHandle: null, targetHandle: 'image' },
    { id: 'e3', canvasId: 'c1', sourceId: 'n2', targetId: 'ext', sourceHandle: null, targetHandle: null },
  ];

  it('extracts internal and boundary edges correctly', () => {
    const sub = extractSubgraph([n1, n2, n3, external], edges, ['n1', 'n2', 'n3']);
    expect(sub.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(sub.edges.map((e) => e.id)).toEqual(['e1']);
    expect(sub.inboundEdges.map((e) => e.id)).toEqual(['e2']);
    expect(sub.outboundEdges.map((e) => e.id)).toEqual(['e3']);
  });

  it('formats subgraph into structured prompt XML', () => {
    const sub = extractSubgraph([n1, n2, external], edges, ['n1', 'n2']);
    const prompt = formatSubgraphForPrompt(sub);
    expect(prompt).toContain('<canvas_subgraph selected_count="2">');
    expect(prompt).toContain('概念图');
    expect(prompt).toContain('赛博朋克雨夜');
    expect(prompt).toContain('镜头一');
    expect(prompt).toContain('kling-1.5');
    expect(prompt).toContain('[概念图] ➔ [镜头一] [start_frame]');
    expect(prompt).toContain('外部前置流入 1 条');
    expect(prompt).toContain('</canvas_subgraph>');
  });

  it('handles empty selections gracefully', () => {
    const sub = extractSubgraph([n1], edges, []);
    expect(formatSubgraphForPrompt(sub)).toBe('');
  });

  it('formats section and subgraph nodes with boundary context', () => {
    const sec = makeNode({
      id: 'sec1',
      type: 'section',
      title: '场景一：街道',
      params: { description: '雨夜积水路面', memberIds: ['n1', 'n2'] },
    });
    const sg = makeNode({
      id: 'sg1',
      type: 'subgraph',
      title: '角色渲染子图',
      params: { description: '生成主角特写', innerNodeIds: ['n1', 'n2', 'n3'] },
    });

    const sub = extractSubgraph([sec, sg], [], ['sec1', 'sg1']);
    const prompt = formatSubgraphForPrompt(sub);
    expect(prompt).toContain('场景分区: "雨夜积水路面" (包含 2 个节点)');
    expect(prompt).toContain('复合子图: "生成主角特写" (内含 3 个节点)');
  });
});
