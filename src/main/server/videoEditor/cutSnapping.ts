import type { Interval } from './mediaAnalysis';

export interface WordSpan { start: number; end: number }
export interface Boundaries { silences: Interval[]; words?: WordSpan[] }
export type SnapReason = 'already-in-silence' | 'snapped-to-silence' | 'snapped-to-word-gap' | 'no-safe-boundary-nearby' | 'mid-word-no-boundary';
export interface SnapResult { seconds: number; shiftSeconds: number; reason: SnapReason }

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Cut slightly inside a silence so neither neighbouring sound is clipped. */
function insideSilence(time: number, silence: Interval): number {
  const pad = Math.min(0.08, silence.duration / 4);
  return Math.min(silence.end - pad, Math.max(silence.start + pad, time));
}

/** Midpoints of the gaps between consecutive words; touching words give no candidate. */
function wordGapCandidates(words: WordSpan[]): number[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - Math.max(sorted[i - 1].end, 0);
    if (gap > 0.02) gaps.push((sorted[i].start + sorted[i - 1].end) / 2);
  }
  return gaps;
}

/**
 * Moves one cut point to the nearest place that does not clip speech: inside a detected silence,
 * else the middle of a gap between words. Never moves further than `maxShiftSeconds`; when no safe
 * place is that close the cut is left untouched and flagged so the Agent can decide.
 */
export function snapCut(time: number, boundaries: Boundaries, maxShiftSeconds = 0.35): SnapResult {
  const unchanged = (reason: SnapReason): SnapResult => ({ seconds: round(time), shiftSeconds: 0, reason });
  if (boundaries.silences.some((s) => time >= s.start && time <= s.end)) return unchanged('already-in-silence');
  const candidates: Array<{ at: number; reason: SnapReason }> = [
    ...boundaries.silences.map((s) => ({ at: insideSilence(time, s), reason: 'snapped-to-silence' as const })),
    ...wordGapCandidates(boundaries.words ?? []).map((at) => ({ at, reason: 'snapped-to-word-gap' as const })),
  ].filter((c) => Math.abs(c.at - time) <= maxShiftSeconds).sort((a, b) => Math.abs(a.at - time) - Math.abs(b.at - time));
  if (candidates[0]) return { seconds: round(candidates[0].at), shiftSeconds: round(candidates[0].at - time), reason: candidates[0].reason };
  const inWord = (boundaries.words ?? []).some((w) => time > w.start && time < w.end);
  return unchanged(inWord ? 'mid-word-no-boundary' : 'no-safe-boundary-nearby');
}

export interface ShotWindow { sourceStartSeconds: number; durationSeconds: number }
export interface SnappedShot {
  sourceStartSeconds: number; durationSeconds: number; durationDeltaSeconds: number;
  start: SnapResult; end: SnapResult;
}

/** Snaps both edges of a source window to the frame grid after moving them to safe boundaries. */
export function snapShot(shot: ShotWindow, boundaries: Boundaries, fps: number, mediaDurationSeconds: number, maxShiftSeconds = 0.35): SnappedShot {
  const grid = (seconds: number) => Math.round(seconds * fps) / fps;
  const start = snapCut(shot.sourceStartSeconds, boundaries, maxShiftSeconds);
  const end = snapCut(shot.sourceStartSeconds + shot.durationSeconds, boundaries, maxShiftSeconds);
  let from = Math.max(0, grid(start.seconds));
  let to = Math.min(mediaDurationSeconds, grid(end.seconds));
  // A tiny shot must never collapse or invert: fall back to the requested window.
  if (to - from < 1 / fps) { from = grid(shot.sourceStartSeconds); to = grid(shot.sourceStartSeconds + shot.durationSeconds); }
  const durationSeconds = round(to - from);
  return { sourceStartSeconds: round(from), durationSeconds, durationDeltaSeconds: round(durationSeconds - shot.durationSeconds), start, end };
}
