import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityTracker } from './activity';

describe('computer activity tracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is busy from the first step until idle, then clears', () => {
    const tracker = createActivityTracker(1000);
    const seen: boolean[] = [];
    tracker.subscribe((b) => seen.push(b));
    const a = {};
    tracker.touch(a);
    vi.advanceTimersByTime(800);
    tracker.touch(a); // another step keeps it alive
    vi.advanceTimersByTime(800);
    expect(tracker.busy).toBe(true);
    vi.advanceTimersByTime(300);
    expect(tracker.busy).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it('stays busy while any task is working; release clears immediately', () => {
    const tracker = createActivityTracker(1000);
    const a = {}; const b = {};
    tracker.touch(a); tracker.touch(b);
    tracker.release(a);
    expect(tracker.busy).toBe(true);
    tracker.release(b);
    expect(tracker.busy).toBe(false);
  });
});
