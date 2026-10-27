/**
 * Which conversations are waiting for the user, and whether that deserves a nudge. A run that needs an approval or
 * an answer sits idle until someone comes back; if the window is in the background the user cannot know.
 */
export interface AttentionInput { id: string; title: string; waiting: boolean }
export interface AttentionSummary { count: number; ids: string[]; /** Title of the first waiting conversation. */ title: string; tooltip: string }

export function summarizeAttention(sessions: readonly AttentionInput[]): AttentionSummary {
  const waiting = sessions.filter((s) => s.waiting);
  const title = waiting[0]?.title.trim().slice(0, 40) ?? '';
  const tooltip = waiting.length === 0
    ? 'Reizo Studio'
    : waiting.length === 1 ? `Reizo · 「${title || '对话'}」在等你确认` : `Reizo · ${waiting.length} 个对话在等你确认`;
  return { count: waiting.length, ids: waiting.map((s) => s.id), title, tooltip };
}

/** Nudge only when something newly started waiting and the window is not in front; never repeat for the same waiting set. */
export function shouldNudge(previousIds: readonly string[], nextIds: readonly string[], windowFocused: boolean): boolean {
  if (windowFocused) return false;
  return nextIds.some((id) => !previousIds.includes(id));
}
