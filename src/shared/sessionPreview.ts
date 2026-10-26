export interface PreviewLine { role: 'user' | 'assistant'; text: string }

/** The last few things said in a conversation, flattened and shortened for a hover card. Tool traffic is skipped. */
export function previewLines(messages: ReadonlyArray<{ role: string; content?: unknown }>, count = 3, maxChars = 160): PreviewLine[] {
  const out: PreviewLine[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < count; i -= 1) {
    const m = messages[i];
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const flat = m.content.replace(/```[\s\S]*?```/g, ' [代码] ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    out.unshift({ role: m.role, text: flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat });
  }
  return out;
}

/** First hover waits; once a preview has been open, moving to the next row switches at once (until the pointer rests elsewhere). */
export const PREVIEW_FIRST_DELAY_MS = 450;
export const PREVIEW_WARM_WINDOW_MS = 600;

export function previewDelay(lastClosedAt: number | null, now: number): number {
  return lastClosedAt !== null && now - lastClosedAt < PREVIEW_WARM_WINDOW_MS ? 0 : PREVIEW_FIRST_DELAY_MS;
}
