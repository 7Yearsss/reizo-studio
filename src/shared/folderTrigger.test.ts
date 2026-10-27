import { describe, expect, it } from 'vitest';
import { createEventBatcher, isPartialFile, matchesPattern } from './folderTrigger';

describe('which files count', () => {
  it('skips scratch and half-written files', () => {
    for (const p of ['a.tmp', 'x/.DS_Store', '~$报告.docx', 'movie.mp4.crdownload', 'notes.md~', 'x/y.part']) expect(isPartialFile(p)).toBe(true);
    for (const p of ['报告.docx', 'sub/订单-2024.xlsx', 'a.md']) expect(isPartialFile(p)).toBe(false);
  });
  it('matches simple globs against the relative path', () => {
    expect(matchesPattern('a/b/订单.xlsx', '*.xlsx')).toBe(true);
    expect(matchesPattern('订单.XLSX', '*.xlsx')).toBe(true);
    expect(matchesPattern('a/b.csv', '*.xlsx')).toBe(false);
    expect(matchesPattern('inbox/a.pdf', 'inbox/*.pdf')).toBe(true);
    expect(matchesPattern('inbox/deep/a.pdf', 'inbox/*.pdf')).toBe(false);
    expect(matchesPattern('inbox/deep/a.pdf', 'inbox/**/*.pdf')).toBe(true);
    expect(matchesPattern('anything.txt', undefined)).toBe(true);
    expect(matchesPattern('a.x+y', 'a.x+y')).toBe(true);
  });
});

describe('createEventBatcher', () => {
  function fake() {
    let time = 0;
    let task: { at: number; fn: () => void } | null = null;
    return {
      now: () => time,
      setTimer: (fn: () => void, ms: number) => { task = { at: time + ms, fn }; return task; },
      clearTimer: () => { task = null; },
      advance(ms: number) { time += ms; if (task && task.at <= time) { const t = task; task = null; t.fn(); } },
    };
  }

  it('turns 100 files landing together into one run that lists them all', () => {
    const clock = fake();
    const runs: Array<{ paths: string[]; omitted: number }> = [];
    const batcher = createEventBatcher({ debounceMs: 2000, maxWaitMs: 30_000, onFire: (b) => runs.push(b), ...clock });
    for (let i = 0; i < 100; i += 1) { batcher.add(`f${i}.pdf`); batcher.add(`f${i}.pdf`); clock.advance(10); }
    expect(runs).toHaveLength(0);
    clock.advance(2000);
    expect(runs).toHaveLength(1);
    expect(runs[0].paths).toHaveLength(100);
  });

  it('still starts a run during a never-ending stream, and caps what it reports', () => {
    const clock = fake();
    const runs: Array<{ paths: string[]; omitted: number }> = [];
    const batcher = createEventBatcher({ debounceMs: 2000, maxWaitMs: 5000, maxPaths: 3, onFire: (b) => runs.push(b), ...clock });
    for (let i = 0; i < 10; i += 1) { batcher.add(`f${i}`); clock.advance(1000); }
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].paths).toHaveLength(3);
    expect(runs[0].omitted).toBeGreaterThan(0);
  });

  it('cancel drops what is waiting', () => {
    const clock = fake();
    const runs: unknown[] = [];
    const batcher = createEventBatcher({ debounceMs: 100, maxWaitMs: 1000, onFire: (b) => runs.push(b), ...clock });
    batcher.add('a');
    batcher.cancel();
    clock.advance(500);
    expect(runs).toEqual([]);
  });
});
