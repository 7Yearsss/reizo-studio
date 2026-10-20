import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMIT_MS, createRevealController } from './revealController';

describe('revealController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('paints the first slice immediately, then reveals the rest on the clock', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('the quick brown fox jumps over the lazy dog');

    expect(commits.length).toBe(1);
    expect(commits[0].length).toBeGreaterThan(0);
    expect(commits[0].length).toBeLessThan('the quick brown fox jumps over the lazy dog'.length);

    vi.advanceTimersByTime(COMMIT_MS);
    expect(commits.length).toBeGreaterThan(1);

    vi.advanceTimersByTime(2000);
    expect(commits.at(-1)).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('coalesces a burst of 1-char pushes onto the clock', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    for (let i = 1; i <= 20; i += 1) rc.push('x'.repeat(i));
    expect(commits.length).toBe(1);
    expect(commits[0].length).toBeLessThan(20);
    vi.advanceTimersByTime(2000);
    expect(commits.at(-1)).toBe('x'.repeat(20));
  });

  it('accelerates when the backlog is large', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    rc.push('x'.repeat(2000));
    // First tick is synchronous; cps = backlog/0.32 -> ~6250/s -> ~313 chars in 50ms
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
    for (let i = 0; i < 100; i += 1) vi.advanceTimersByTime(COMMIT_MS);
    for (const c of commits) {
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(commits.at(-1)).toBe(emoji);
  });

  it('smoothly streams consecutive chunk packets without stuttering or stopping early', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));

    // Simulate 3 network chunks arriving at 100ms intervals
    const chunk1 = '你好，我是Reizo Studio。';
    const chunk2 = chunk1 + '正在为你生成流畅的代码和架构设计。';
    const chunk3 = chunk2 + '我们将以丝滑流体速度场持续输出文字！';

    rc.push(chunk1);
    expect(commits.length).toBe(1);

    // After 100ms: should have made multiple smooth commits without fully exhausting
    vi.advanceTimersByTime(100);
    const countAfter100 = commits.length;
    expect(countAfter100).toBeGreaterThan(2);

    // Deliver chunk 2
    rc.push(chunk2);
    vi.advanceTimersByTime(100);
    const countAfter200 = commits.length;
    expect(countAfter200).toBeGreaterThan(countAfter100);

    // Deliver chunk 3
    rc.push(chunk3);
    vi.advanceTimersByTime(100);
    expect(commits.length).toBeGreaterThan(countAfter200);

    // Drain completely
    vi.advanceTimersByTime(3000);
    expect(commits.at(-1)).toBe(chunk3);

    // Ensure monotonic growth across all commits
    for (let i = 1; i < commits.length; i++) {
      expect(commits[i].length).toBeGreaterThanOrEqual(commits[i - 1].length);
      expect(commits[i].startsWith(commits[i - 1])).toBe(true);
    }
  });

  it('handles mixed Chinese characters and emojis smoothly without splitting', () => {
    const commits: string[] = [];
    const rc = createRevealController((t) => commits.push(t));
    const mixed = '🚀 正在启动服务器… 这是一个测试 🎉 性能极佳 ⚡️';
    rc.push(mixed);

    vi.advanceTimersByTime(2000);
    expect(commits.at(-1)).toBe(mixed);

    for (const text of commits) {
      if (text.length > 0) {
        const lastCode = text.charCodeAt(text.length - 1);
        expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
      }
    }
  });
});
