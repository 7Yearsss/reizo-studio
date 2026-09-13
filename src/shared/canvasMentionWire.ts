import type { CanvasNode, CanvasNodeType } from './canvas';

/** Prompt field that stores canonical `@[label](canvas:id)` tokens. */
export function mentionPromptKey(type: CanvasNodeType): 'prompt' | 'content' | null {
  if (type === 'note') return 'content';
  if (type === 'image' || type === 'video' || type === 'audio') return 'prompt';
  return null;
}

/** First-frame / last-frame / edit-source — topology, not a named prompt entity. */
export function isStructuralTargetHandle(targetHandle: string | null | undefined): boolean {
  return targetHandle === 'start_frame' || targetHandle === 'end_frame' || targetHandle === 'edit_src';
}

/**
 * Whether this edge is the graph twin of an inline @ chip.
 * Structural sockets stay out of that loop so @ cannot silently become a first frame.
 */
export function shouldSyncMentionOnEdge(
  targetHandle: string | null | undefined,
  sourceType?: CanvasNodeType,
): boolean {
  if (isStructuralTargetHandle(targetHandle)) return false;
  if (targetHandle === 'audio_in') return true;
  if (targetHandle === 'reference' || targetHandle === 'image' || (targetHandle?.startsWith('ref_') ?? false)) {
    return true;
  }
  if (targetHandle === 'prompt') return true;
  return false;
}

function sourceHandleOf(type: CanvasNodeType): string | null {
  switch (type) {
    case 'image':
      return 'image_out';
    case 'video':
      return 'prompt_out';
    case 'audio':
      return 'audio_out';
    case 'note':
      return 'prompt_out';
    default:
      return null;
  }
}

export interface MentionWirePlan {
  sourceHandle: string | null;
  targetHandle: string | null;
}

/**
 * Default sockets for "@ this node from that composer".
 * Image/video/anchor onto a video node always land on `reference`, never start_frame.
 */
export function planMentionWire(
  source: Pick<CanvasNode, 'id' | 'type'>,
  target: Pick<CanvasNode, 'id' | 'type'>,
): MentionWirePlan | null {
  if (source.id === target.id) return null;
  if (
    source.type === 'group' ||
    source.type === 'section' ||
    target.type === 'group' ||
    target.type === 'section'
  ) {
    return null;
  }

  const sourceHandle = sourceHandleOf(source.type);

  if (source.type === 'audio') {
    if (target.type !== 'video' && target.type !== 'audio') return null;
    return { sourceHandle, targetHandle: target.type === 'video' ? 'audio_in' : 'prompt' };
  }

  if (source.type === 'note' || source.type === 'agent') {
    return { sourceHandle, targetHandle: 'prompt' };
  }

  if (target.type === 'image' || target.type === 'video') {
    return { sourceHandle, targetHandle: 'reference' };
  }

  if (target.type === 'note' || target.type === 'audio' || target.type === 'agent') {
    return { sourceHandle, targetHandle: 'prompt' };
  }

  return null;
}
