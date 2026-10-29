export interface ReadingAnchor {
  /** The message at the top of the viewport. */
  messageId: string;
  /** How far that message's top sits below the viewport top (negative: scrolled into it). */
  offset: number;
}

const MAX_SESSIONS = 60;

export function parseAnchors(raw: string | null): Record<string, ReadingAnchor> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ReadingAnchor> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<ReadingAnchor> | null;
      if (v && typeof v.messageId === 'string' && typeof v.offset === 'number' && Number.isFinite(v.offset)) {
        out[sessionId] = { messageId: v.messageId, offset: Math.round(v.offset) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Set or clear one session's anchor, keeping only the most recently touched sessions. */
export function withAnchor(
  anchors: Record<string, ReadingAnchor>,
  sessionId: string,
  anchor: ReadingAnchor | null,
): Record<string, ReadingAnchor> {
  const { [sessionId]: _old, ...rest } = anchors;
  if (!anchor) return rest;
  const entries = [...Object.entries(rest), [sessionId, { ...anchor, offset: Math.round(anchor.offset) }] as const];
  return Object.fromEntries(entries.slice(-MAX_SESSIONS));
}

/**
 * The anchor to remember for a scroll position: the first message still (partly) in view. Null when the reader is
 * at the live edge (nothing to restore) or no message is in view.
 */
export function pickAnchor(
  rects: readonly { id: string; top: number; bottom: number }[],
  viewportTop: number,
  atLiveEdge: boolean,
): ReadingAnchor | null {
  if (atLiveEdge) return null;
  const first = rects.find((r) => r.bottom > viewportTop + 1);
  return first ? { messageId: first.id, offset: first.top - viewportTop } : null;
}
