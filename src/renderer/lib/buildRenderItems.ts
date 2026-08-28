import type { ChatMessage } from '../../shared/chat';

/**
 * Projects the message list into render items. Today it's ~1:1 with
 * messages (tool calls are embedded as `parts` on an assistant message, so
 * there are no orphan tool rows to fold), but this is the seam where future
 * splitting (separate tool / thinking rows, collapsed action blocks) will
 * live. The window in `MessageList` slices over render items, not raw
 * messages, and snaps its start to a turn boundary so the top of the
 * viewport is never a context-free fragment.
 */

export interface RenderItem {
  key: string;
  message: ChatMessage;
  /** Rough serialized size, for the first-paint byte budget. */
  bytes: number;
  /** A user message opens a turn. */
  turnStart: boolean;
}

export const WINDOW_INITIAL_ITEMS = 80;
export const WINDOW_GROW_ITEMS = 80;
export const FIRST_PAINT_BUDGET_BYTES = 64_000;

function itemBytes(message: ChatMessage): number {
  let n = message.content.length;
  for (const part of message.parts ?? []) {
    n += (part.result?.length ?? 0) + (part.error?.length ?? 0) + part.name.length;
  }
  return n;
}

export function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  return messages.map((message) => ({
    key: message.id,
    message,
    bytes: itemBytes(message),
    turnStart: message.role === 'user',
  }));
}

/** Walk `start` backward to the nearest turn boundary (never past 0). */
export function snapWindowStart(items: RenderItem[], start: number): number {
  let i = Math.max(0, Math.min(start, items.length));
  while (i > 0 && !items[i]?.turnStart) i -= 1;
  return i;
}

/**
 * How many trailing items to show on first paint: the count cap, then
 * tightened by the byte budget (few-but-huge items), then snapped to a turn
 * boundary.
 */
export function initialWindowStart(items: RenderItem[]): number {
  if (items.length <= WINDOW_INITIAL_ITEMS) return 0;
  let start = items.length - WINDOW_INITIAL_ITEMS;
  let budget = FIRST_PAINT_BUDGET_BYTES;
  for (let i = items.length - 1; i >= start; i -= 1) {
    budget -= items[i].bytes;
    if (budget < 0) {
      start = i + 1;
      break;
    }
  }
  return snapWindowStart(items, start);
}
