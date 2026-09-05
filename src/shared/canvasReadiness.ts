import { getVideoModelCapabilities, type CanvasEdge, type CanvasNode } from './canvas';
import { CANONICAL_MENTION_RE } from './resolveMentions';

/**
 * Reasons a node would fail or produce a poor result if run right now.
 * Empty array = ready. Pure and synchronous so the node badge (and, later,
 * the executor pre-flight) can share it.
 */
export function nodeReadinessIssues(
  node: CanvasNode,
  edges: CanvasEdge[],
  nodesById: Map<string, CanvasNode>,
): string[] {
  const issues: string[] = [];
  const params = (node.params ?? {}) as Record<string, unknown>;

  const canonicalRefs = (text: string): { id: string; label: string }[] => {
    const out: { id: string; label: string }[] = [];
    const re = new RegExp(CANONICAL_MENTION_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ label: m[1], id: m[2] });
    return out;
  };

  if (node.type === 'image' || node.type === 'video') {
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
    const hasUpstreamPrompt = edges.some((e) => {
      if (e.targetId !== node.id) return false;
      if (e.targetHandle === 'prompt') return true;
      const src = nodesById.get(e.sourceId);
      return src?.type === 'note' || src?.type === 'agent';
    });
    if (!prompt && !hasUpstreamPrompt) issues.push('提示词为空');
    for (const ref of canonicalRefs(prompt)) {
      const target = nodesById.get(ref.id);
      if (!target) issues.push(`引用「${ref.label}」的节点已被删除`);
      else if ((target.output?.assets?.length ?? 0) === 0) {
        issues.push(`引用「${target.title || ref.label}」尚未生成画面`);
      }
    }
  }

  if (node.type === 'video') {
    const model = typeof params.model === 'string' ? params.model : undefined;
    const caps = getVideoModelCapabilities(model);
    const frameEdges = edges.filter(
      (e) =>
        e.targetId === node.id &&
        (e.targetHandle === 'start_frame' || e.targetHandle === 'end_frame'),
    );
    for (const e of frameEdges) {
      if (e.targetHandle === 'end_frame' && !caps.endFrame) {
        issues.push(`当前模型不支持尾帧插值`);
      }
      const src = nodesById.get(e.sourceId);
      if (src && (src.output?.assets?.length ?? 0) === 0) {
        issues.push(`${e.targetHandle === 'start_frame' ? '首帧' : '尾帧'}来源「${src.title || '上游节点'}」尚未生成`);
      }
    }
  }

  if (node.type === 'frameExtractor') {
    const inEdge = edges.find((e) => e.targetId === node.id);
    if (!inEdge) {
      issues.push('未连接上游视频源');
    } else {
      const src = nodesById.get(inEdge.sourceId);
      if (!src || (src.output?.assets?.length ?? 0) === 0) {
        issues.push(`上游视频「${src?.title || '视频源'}」尚未生成`);
      }
    }
  }

  if (node.type === 'agent') {
    const instr = typeof params.instruction === 'string' ? params.instruction.trim() : '';
    if (!instr) issues.push('任务描述为空');
  }

  return issues;
}
