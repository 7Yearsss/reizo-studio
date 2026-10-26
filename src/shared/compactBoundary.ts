import type { ChatMessage } from './chat';

/**
 * A compaction is stored as one extra `system` row; nothing earlier is edited or deleted. The model sees the
 * summary in place of everything up to the boundary (and only the LAST boundary counts), while the user keeps
 * the full transcript on screen.
 */
export const COMPACT_BOUNDARY_PREFIX = 'compact-boundary-';

export interface CompactBoundaryPayload {
  summaryText: string;
  /** Id of the last message the summary covers. */
  summarizedToId: string;
  source: 'manual' | 'auto';
}

export function isCompactBoundary(message: Pick<ChatMessage, 'id' | 'role'>): boolean {
  return message.role === 'system' && message.id.startsWith(COMPACT_BOUNDARY_PREFIX);
}

export function parseBoundary(message: Pick<ChatMessage, 'content'>): CompactBoundaryPayload | null {
  try {
    const value = JSON.parse(message.content) as Partial<CompactBoundaryPayload>;
    if (typeof value.summaryText !== 'string' || typeof value.summarizedToId !== 'string') return null;
    return { summaryText: value.summaryText, summarizedToId: value.summarizedToId, source: value.source === 'auto' ? 'auto' : 'manual' };
  } catch {
    return null;
  }
}

export function makeBoundary(payload: CompactBoundaryPayload, id: string, now = new Date()): ChatMessage {
  return { id: `${COMPACT_BOUNDARY_PREFIX}${id}`, role: 'system', content: JSON.stringify(payload), createdAt: now.toISOString() };
}

export const SUMMARY_PREAMBLE =
  '[Summary of the earlier part of this conversation, written when it was compacted. Treat it as accurate background; the messages that follow are verbatim.]\n\n';

/**
 * What the model should be given: the summary (as one user message) followed by every real message after the
 * last valid boundary. Without a boundary the messages pass through unchanged (boundary rows are never sent).
 */
export function messagesForModel(messages: ChatMessage[]): ChatMessage[] {
  const real = (list: ChatMessage[]) => list.filter((m) => !isCompactBoundary(m));
  let boundaryIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundary(messages[i]) && parseBoundary(messages[i])) {
      boundaryIndex = i;
      break;
    }
  }
  if (boundaryIndex < 0) return real(messages);
  const payload = parseBoundary(messages[boundaryIndex])!;
  const toIndex = messages.findIndex((m) => m.id === payload.summarizedToId);
  // A boundary whose anchor message is gone is ignored rather than dropping history on a guess.
  if (toIndex < 0 || toIndex > boundaryIndex) return real(messages);
  const summary: ChatMessage = {
    id: messages[boundaryIndex].id,
    role: 'user',
    content: SUMMARY_PREAMBLE + payload.summaryText,
    createdAt: messages[boundaryIndex].createdAt,
  };
  return [summary, ...real(messages.slice(toIndex + 1))];
}

/**
 * The messages to summarise (everything the model currently sees, except the last `keepRecentTurns` user
 * turns, which stay verbatim) and the id of the last one covered. Null when there is nothing worth summarising.
 * A previous summary is carried at the front, so a second compaction folds it in.
 */
export function summarizableRange(messages: ChatMessage[], keepRecentTurns: number): { messages: ChatMessage[]; toId: string } | null {
  const visible = messagesForModel(messages);
  const startsWithSummary = visible[0]?.id.startsWith(COMPACT_BOUNDARY_PREFIX) ?? false;
  const turnIndexes = visible.map((m, i) => (m.role === 'user' && !(startsWithSummary && i === 0) ? i : -1)).filter((i) => i >= 0);
  if (turnIndexes.length <= keepRecentTurns) return null;
  const cut = turnIndexes[turnIndexes.length - keepRecentTurns];
  const covered = visible.slice(0, cut);
  if (covered.length === 0) return null;
  return { messages: covered, toId: covered[covered.length - 1].id };
}
