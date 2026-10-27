import { describe, expect, it } from 'vitest';
import { formatMs, traceBars, turnLanes } from './traceView';

describe('traceBars', () => {
  it('places calls on the timeline, carrying the outcome and error from the tool list', () => {
    const bars = traceBars(10_000, [{ name: 'read_file', startMs: 1000, endMs: 2000 }, { name: 'run_command', startMs: 5000, endMs: 9000 }], [
      { name: 'read_file', ms: 1000, ok: true },
      { name: 'run_command', ms: 4000, ok: false, error: 'exit 1' },
    ]);
    expect(bars[0]).toMatchObject({ name: 'read_file', ok: true, leftPct: 10, widthPct: 10, ms: 1000 });
    expect(bars[1]).toMatchObject({ name: 'run_command', ok: false, error: 'exit 1', leftPct: 50, widthPct: 40 });
  });
  it('gives calls without timeline entries a bar after the previous one, and never an invisible one', () => {
    const bars = traceBars(1000, undefined, [{ name: 'a', ms: 200, ok: true }, { name: 'b', ms: 1, ok: true }]);
    expect(bars[0].leftPct).toBe(0);
    expect(bars[1].leftPct).toBe(20);
    expect(bars[1].widthPct).toBeGreaterThanOrEqual(0.8);
  });
  it('a call still running when the turn ended is open-ended and not marked ok', () => {
    const [bar] = traceBars(4000, [{ name: 'run_command', startMs: 1000 }], []);
    expect(bar.ok).toBe(false);
    expect(bar.leftPct + bar.widthPct).toBeLessThanOrEqual(100);
  });
  it('formats durations', () => {
    expect(formatMs(250)).toBe('250 ms');
    expect(formatMs(2500)).toBe('2.5 s');
    expect(formatMs(undefined)).toBe('—');
  });
});

describe('turnLanes', () => {
  it('always adds up to the total, counting overlapping tool calls once', () => {
    const lanes = turnLanes(10_000, [{ startMs: 1000, endMs: 6000 }, { startMs: 2000, endMs: 5000 }, { startMs: 8000, endMs: 9000 }]);
    expect(lanes).toEqual({ toolMs: 6000, modelMs: 4000 });
    expect(lanes.toolMs + lanes.modelMs).toBe(10_000);
  });
  it('treats a call still running at the end as running to the end, and ignores bad spans', () => {
    expect(turnLanes(5000, [{ startMs: 4000 }, { startMs: 3000, endMs: 3000 }])).toEqual({ toolMs: 1000, modelMs: 4000 });
    expect(turnLanes(0, undefined)).toEqual({ toolMs: 0, modelMs: 0 });
  });
});
