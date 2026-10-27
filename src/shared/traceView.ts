export interface TraceToolRow { name: string; startMs?: number; endMs?: number; ms?: number; ok?: boolean; error?: string }

export interface TraceBar { name: string; ok: boolean; error?: string; leftPct: number; widthPct: number; ms?: number }

/**
 * Lay tool calls out on the turn's timeline. A call with start/end times is positioned where it ran; one with only a
 * duration is stacked after the previous one so every call still gets a visible bar. Widths have a minimum so a
 * 5 ms call is not invisible.
 */
export function traceBars(
  durationMs: number,
  timeline: ReadonlyArray<{ name: string; startMs: number; endMs?: number }> | undefined,
  tools: ReadonlyArray<{ name: string; ms?: number; ok: boolean; error?: string }>,
): TraceBar[] {
  const total = Math.max(durationMs, 1);
  const failures = [...tools];
  const bars: TraceBar[] = [];
  let cursor = 0;
  const pct = (ms: number): number => Math.min(100, Math.max(0, (ms / total) * 100));
  for (const call of timeline ?? []) {
    const matchIndex = failures.findIndex((t) => t.name === call.name);
    const match = matchIndex >= 0 ? failures.splice(matchIndex, 1)[0] : undefined;
    const end = call.endMs ?? total;
    bars.push({ name: call.name, ok: match?.ok ?? call.endMs !== undefined, error: match?.error, leftPct: pct(call.startMs), widthPct: Math.max(0.8, pct(end - call.startMs)), ms: match?.ms ?? (call.endMs !== undefined ? call.endMs - call.startMs : undefined) });
    cursor = Math.max(cursor, end);
  }
  for (const t of failures) {
    const ms = t.ms ?? 0;
    bars.push({ name: t.name, ok: t.ok, error: t.error, leftPct: pct(cursor), widthPct: Math.max(0.8, pct(ms)), ms: t.ms });
    cursor += ms;
  }
  return bars;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
