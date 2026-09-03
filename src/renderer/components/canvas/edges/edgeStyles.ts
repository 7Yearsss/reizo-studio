export const EDGE_COLORS = {
  prompt: '#2dd4bf', // 文本/prompt (teal)
  image: '#818cf8', // 图像 (indigo)
  startFrame: '#f59e0b', // 首帧 (amber)
  endFrame: '#f59e0b', // 尾帧 (amber)
  video: '#38bdf8', // 视频产物 (sky)
  reference: '#a78bfa', // 参考图钉 (violet)
  default: '#94a3b8', // 默认 (slate)
} as const;

export type EdgeKind = keyof typeof EDGE_COLORS;

/**
 * Derives the semantic edge color kind from node types and handles.
 * - Handles 'start_frame' -> startFrame, 'end_frame' -> endFrame
 * - Otherwise maps by sourceType: image -> image, video -> video, agent/note -> prompt
 */
export function edgeKind(
  sourceType: string | undefined,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): EdgeKind {
  if (sourceType === 'anchor' || targetHandle === 'reference') return 'reference';
  if (sourceHandle === 'start_frame' || targetHandle === 'start_frame' || sourceHandle === 'startFrame') {
    return 'startFrame';
  }
  if (sourceHandle === 'end_frame' || targetHandle === 'end_frame' || sourceHandle === 'endFrame') {
    return 'endFrame';
  }
  if (sourceHandle === 'prompt' || targetHandle === 'prompt' || sourceHandle === 'textOut') {
    return 'prompt';
  }
  if (sourceType === 'image') return 'image';
  if (sourceType === 'video') return 'video';
  if (sourceType === 'agent' || sourceType === 'note') return 'prompt';
  return 'default';
}

export function getSourceHandleColor(sourceType?: string, sourceHandle?: string | null): string {
  if (sourceType === 'anchor') return EDGE_COLORS.reference;
  if (sourceHandle === 'start_frame' || sourceHandle === 'startFrame') return EDGE_COLORS.startFrame;
  if (sourceHandle === 'end_frame' || sourceHandle === 'endFrame') return EDGE_COLORS.endFrame;
  if (sourceHandle === 'prompt' || sourceHandle === 'textOut') return EDGE_COLORS.prompt;
  if (sourceType === 'image') return EDGE_COLORS.image;
  if (sourceType === 'video') return EDGE_COLORS.video;
  if (sourceType === 'agent' || sourceType === 'note') return EDGE_COLORS.prompt;
  return EDGE_COLORS.default;
}

export function getTargetHandleColor(targetType?: string, targetHandle?: string | null): string {
  if (targetHandle === 'reference') return EDGE_COLORS.reference;
  if (targetHandle === 'start_frame' || targetHandle === 'startFrame') return EDGE_COLORS.startFrame;
  if (targetHandle === 'end_frame' || targetHandle === 'endFrame') return EDGE_COLORS.endFrame;
  if (targetHandle === 'prompt') return EDGE_COLORS.prompt;
  if (targetType === 'image') return EDGE_COLORS.image;
  if (targetType === 'video') return EDGE_COLORS.video;
  return EDGE_COLORS.default;
}
