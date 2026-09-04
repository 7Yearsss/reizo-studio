import type {
  CanvasEdge,
  CanvasNode,
  CanvasVideoParams,
  CanvasImageParams,
  CanvasAgentParams,
  CanvasNoteParams,
  CanvasSectionParams,
  CanvasSubgraphParams,
} from './canvas';

export interface SubgraphData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  inboundEdges: CanvasEdge[];
  outboundEdges: CanvasEdge[];
}

/**
 * Extracts a structured subgraph for a given set of node IDs,
 * including strictly internal edges and boundary-crossing edges.
 */
export function extractSubgraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedNodeIds: string[],
): SubgraphData {
  const selectedSet = new Set(selectedNodeIds);
  const subNodes = nodes.filter((n) => selectedSet.has(n.id));
  const internalEdges = edges.filter((e) => selectedSet.has(e.sourceId) && selectedSet.has(e.targetId));
  const inboundEdges = edges.filter((e) => !selectedSet.has(e.sourceId) && selectedSet.has(e.targetId));
  const outboundEdges = edges.filter((e) => selectedSet.has(e.sourceId) && !selectedSet.has(e.targetId));

  return {
    nodes: subNodes,
    edges: internalEdges,
    inboundEdges,
    outboundEdges,
  };
}

/**
 * Serializes a topological subgraph into a compact, token-efficient XML/Markdown block
 * suitable for LLM injection, preserving handle semantics and execution states.
 */
export function formatSubgraphForPrompt(
  subgraph: SubgraphData,
  options: { maxPromptLength?: number } = {},
): string {
  const { maxPromptLength = 120 } = options;
  if (subgraph.nodes.length === 0) return '';

  const nodeMap = new Map<string, CanvasNode>(subgraph.nodes.map((n) => [n.id, n]));

  const lines: string[] = [];
  lines.push(`<canvas_subgraph selected_count="${subgraph.nodes.length}">`);
  lines.push('### 选区节点明细');

  for (const node of subgraph.nodes) {
    const title = node.title || (node.type === 'video' ? '视频分镜' : node.type === 'image' ? '图片生成' : node.type);
    const params = (node.params ?? {}) as Record<string, unknown>;
    let content = '';

    if (node.type === 'video') {
      const vp = params as Partial<CanvasVideoParams>;
      content = vp.prompt ? `提示词: "${vp.prompt.slice(0, maxPromptLength)}${vp.prompt.length > maxPromptLength ? '…' : ''}"` : '';
      if (vp.model) content += ` (模型: ${vp.model})`;
    } else if (node.type === 'image') {
      const ip = params as Partial<CanvasImageParams>;
      content = ip.prompt ? `提示词: "${ip.prompt.slice(0, maxPromptLength)}${ip.prompt.length > maxPromptLength ? '…' : ''}"` : '';
      if (ip.model) content += ` (模型: ${ip.model})`;
    } else if (node.type === 'agent') {
      const ap = params as Partial<CanvasAgentParams>;
      content = ap.instruction ? `指令: "${ap.instruction.slice(0, maxPromptLength)}"` : '';
    } else if (node.type === 'note') {
      const np = params as Partial<CanvasNoteParams>;
      content = np.content ? `内容: "${np.content.slice(0, maxPromptLength)}"` : '';
    } else if (node.type === 'section') {
      const sp = params as Partial<CanvasSectionParams>;
      content = `场景分区: ${sp.description ? `"${sp.description.slice(0, maxPromptLength)}"` : '(无描述)'}`;
      if (sp.memberIds?.length) content += ` (包含 ${sp.memberIds.length} 个节点)`;
    } else if (node.type === 'subgraph') {
      const sgp = params as Partial<CanvasSubgraphParams>;
      const count = sgp.innerSnapshot?.nodes?.length ?? sgp.innerNodeIds?.length ?? 0;
      content = `复合子图: ${sgp.description ? `"${sgp.description.slice(0, maxPromptLength)}"` : ''} (内含 ${count} 个节点)`;
    }

    const runInfo = `状态: ${node.runState}${node.output?.assets?.length ? `, 产物: ${node.output.assets.length}个` : ''}`;
    lines.push(`- [${title}] (ID: ${node.id}, 类型: ${node.type}, ${runInfo})`);
    if (content) lines.push(`  ${content}`);
  }

  if (subgraph.edges.length > 0) {
    lines.push('\n### 内部拓扑连线');
    for (const edge of subgraph.edges) {
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      const srcLabel = src?.title || edge.sourceId;
      const tgtLabel = tgt?.title || edge.targetId;
      const handle = edge.targetHandle ? ` [${edge.targetHandle}]` : '';
      lines.push(`- [${srcLabel}] ➔ [${tgtLabel}]${handle}`);
    }
  }

  if (subgraph.inboundEdges.length > 0 || subgraph.outboundEdges.length > 0) {
    lines.push(`\n### 边界依赖: 外部前置流入 ${subgraph.inboundEdges.length} 条, 外部后置流出 ${subgraph.outboundEdges.length} 条`);
  }

  lines.push('</canvas_subgraph>');
  return lines.join('\n');
}
