import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRevealController } from './revealController';

describe('revealController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reveals text progressively, not all at once', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('the quick brown fox jumps over the lazy dog');

    vi.advanceTimersByTime(33);
    expect(commits.length).toBe(1);
    expect(commits[0].length).toBeGreaterThan(0);
    expect(commits[0].length).toBeLessThan('the quick brown fox jumps over the lazy dog'.length);

    vi.advanceTimersByTime(2000);
    expect(commits.at(-1)).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('accelerates when the backlog is large', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('x'.repeat(2000));
    vi.advanceTimersByTime(33);
    // cps = backlog/0.32 -> ~6250/s -> ~206 chars in 33ms
    expect(commits[0].length).toBeGreaterThan(100);
  });

  it('flush() reveals everything immediately and stops the clock', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('hello world this is a longer piece of streamed text');
    rc.flush();
    expect(commits.at(-1)).toBe('hello world this is a longer piece of streamed text');
    const n = commits.length;
    vi.advanceTimersByTime(1000);
    expect(commits.length).toBe(n); // no further commits
  });

  it('reset() stops the clock and clears', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('some streaming text here');
    rc.reset();
    const n = commits.length;
    vi.advanceTimersByTime(1000);
    expect(commits.length).toBe(n);
  });

  it('never commits a string that splits a surrogate pair', () => {
    const emoji = '😀'.repeat(50); // each is a surrogate pair
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push(emoji);
    for (let i = 0; i < 100; i += 1) vi.advanceTimersByTime(33);
    for (const c of commits) {
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(commits.at(-1)).toBe(emoji);
  });
});
