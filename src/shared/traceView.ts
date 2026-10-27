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

export interface TurnLanes { toolMs: number; modelMs: number }

/**
 * Split a turn's wall time (from the first event; preparation before it is reported separately) into tool
 * execution and everything else (model streaming and waiting), so the two always add up to the total. Overlapping tool calls are merged first — two parallel 5 s calls are
 * 5 s of tool time, not 10. Tool time includes any wait for the user's approval, which the trace does not separate.
 */
export function turnLanes(
  durationMs: number,
  timeline: ReadonlyArray<{ startMs: number; endMs?: number }> | undefined,
): TurnLanes {
  const total = Math.max(0, durationMs);
  const spans = (timeline ?? [])
    .map((call) => ({ start: Math.max(0, call.startMs), end: Math.min(total, call.endMs ?? total) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  let toolMs = 0;
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    if (span.end > start) { toolMs += span.end - start; cursor = span.end; }
  }
  return { toolMs, modelMs: Math.max(0, total - toolMs) };
}
