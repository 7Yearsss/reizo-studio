/**
 * One colour per data type — same type, same colour, everywhere (edge line,
 * source handle, target handle). Runway-style: green prompt, red video, etc.
 */
export const EDGE_COLORS = {
  prompt: '#4ade80', // 提示词 / 文本响应 (green)
  image: '#818cf8', // 图像 (indigo)
  startFrame: '#60a5fa', // 首帧 (blue)
  endFrame: '#60a5fa', // 尾帧 (blue)
  video: '#f43f5e', // 视频 (crimson)
  audio: '#f59e0b', // 音频 (amber) — reserved, no audio nodes yet
  reference: '#a78bfa', // 参考图钉 (violet)
  default: '#94a3b8', // 默认 (slate)
} as const;

export type EdgeKind = keyof typeof EDGE_COLORS;

/** Colour for a handle/edge of a given semantic kind. */
export function colorForKind(kind: EdgeKind): string {
  return EDGE_COLORS[kind] ?? EDGE_COLORS.default;
}

/**
 * Derives the semantic edge color kind from node types and handles.
 * - `anchor` source / `reference` (or `ref_N`) target -> reference
 * - Handles 'start_frame' -> startFrame, 'end_frame' -> endFrame
 * - Otherwise maps by sourceType: image -> image, video -> video, agent/note -> prompt
 */
export function edgeKind(
  sourceType: string | undefined,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): EdgeKind {
  if (sourceType === 'anchor' || targetHandle === 'reference' || targetHandle?.startsWith('ref_')) {
    return 'reference';
  }
  if (sourceHandle === 'start_frame' || targetHandle === 'start_frame' || sourceHandle === 'startFrame') {
    return 'startFrame';
  }
  if (sourceHandle === 'end_frame' || targetHandle === 'end_frame' || sourceHandle === 'endFrame') {
    return 'endFrame';
  }
  if (sourceHandle === 'prompt' || targetHandle === 'prompt' || sourceHandle === 'textOut' || sourceHandle === 'prompt_out' || targetHandle === 'text_in') {
    return 'prompt';
  }
  if (sourceHandle === 'audio_out' || targetHandle === 'audio_in' || targetHandle === 'audio' || sourceType === 'audio') {
    return 'audio';
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
  if (sourceHandle === 'prompt' || sourceHandle === 'textOut' || sourceHandle === 'prompt_out') return EDGE_COLORS.prompt;
  if (sourceType === 'audio' || sourceHandle === 'audio_out') return EDGE_COLORS.audio;
  if (sourceType === 'image') return EDGE_COLORS.image;
  if (sourceType === 'video') return EDGE_COLORS.video;
  if (sourceType === 'agent' || sourceType === 'note') return EDGE_COLORS.prompt;
  return EDGE_COLORS.default;
}

export function getTargetHandleColor(targetType?: string, targetHandle?: string | null): string {
  if (targetHandle === 'reference' || targetHandle?.startsWith('ref_')) return EDGE_COLORS.reference;
  if (targetHandle === 'start_frame' || targetHandle === 'startFrame') return EDGE_COLORS.startFrame;
  if (targetHandle === 'end_frame' || targetHandle === 'endFrame') return EDGE_COLORS.endFrame;
  if (targetHandle === 'prompt' || targetHandle === 'text_in') return EDGE_COLORS.prompt;
  if (targetHandle === 'audio_in' || targetHandle === 'audio' || targetType === 'audio') return EDGE_COLORS.audio;
  if (targetType === 'image') return EDGE_COLORS.image;
  if (targetType === 'video') return EDGE_COLORS.video;
  return EDGE_COLORS.default;
}
