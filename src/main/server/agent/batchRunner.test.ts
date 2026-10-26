import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBatchResult, runBatch, type BatchRow } from './batchRunner';

const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `任务${i + 1}`, task: `do ${i + 1}` }));

describe('runBatch', () => {
  it('never exceeds the concurrency cap and keeps input order', async () => {
    let live = 0;
    let peak = 0;
    const rows = await runBatch({
      tasks: tasks(6), concurrency: 2,
      runOne: async (t) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return `done ${t.title}`; },
    });
    expect(peak).toBe(2);
    expect(rows.map((r) => r.detail)).toEqual(tasks(6).map((t) => `done ${t.title}`));
    expect(rows.every((r) => r.status === 'succeeded')).toBe(true);
  });

  it('one failing task does not sink the others, and the failure is recorded', async () => {
    const rows = await runBatch({
      tasks: tasks(3), concurrency: 3,
      runOne: async (t) => { if (t.title === '任务2') throw new Error('boom'); return 'ok'; },
    });
    expect(rows.map((r) => r.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(rows[1]).toMatchObject({ reason: 'error', detail: 'boom' });
  });

  it('publishes a snapshot per change so a UI can show each row live', async () => {
    const snapshots: BatchRow[][] = [];
    await runBatch({ tasks: tasks(2), concurrency: 1, runOne: async (_t, ctx) => { ctx.heartbeat(); return 'x'; }, onUpdate: (r) => snapshots.push(r) });
    expect(snapshots[0].map((r) => r.status)).toEqual(['queued', 'queued']);
    expect(snapshots.some((s) => s[0].status === 'running' && s[1].status === 'queued')).toBe(true);
    expect(snapshots.some((s) => s[0].steps === 1)).toBe(true);
    expect(snapshots.at(-1)!.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('an outer abort stops running and queued tasks', async () => {
    const controller = new AbortController();
    const rows = await runBatch({
      tasks: tasks(3), concurrency: 1, signal: controller.signal,
      runOne: async (_t, ctx) => {
        controller.abort();
        if (ctx.signal.aborted) throw new Error('aborted'); // the inner signal follows the outer one
        return '';
      },
    });
    expect(rows.map((r) => r.status)).toEqual(['stopped', 'stopped', 'stopped']);
    expect(rows.every((r) => r.reason === 'aborted')).toBe(true);
  });
});

describe('stall watchdog (heartbeat, not total time)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops only the silent task; a task that keeps stepping may run far longer than the stall window', async () => {
    const pending = runBatch({
      tasks: tasks(2), concurrency: 2, stallMs: 1000,
      runOne: async (t, ctx) => {
        if (t.title === '任务1') { // silent: never heartbeats
          await new Promise((_r, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))));
          return '';
        }
        for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 800)); ctx.heartbeat(); } // 4.8s total > 1s window
        return 'finished';
      },
    });
    await vi.advanceTimersByTimeAsync(6000);
    const rows = await pending;
    expect(rows[0]).toMatchObject({ status: 'stopped', reason: 'stalled' });
    expect(rows[1]).toMatchObject({ status: 'succeeded', detail: 'finished', steps: 6 });
  });
});

describe('formatBatchResult', () => {
  it('labels every task so a stopped or failed one is never read as done', () => {
    const text = formatBatchResult([
      { index: 0, title: 'A', status: 'succeeded', steps: 2, detail: 'result A' },
      { index: 1, title: 'B', status: 'stopped', reason: 'stalled', steps: 0, detail: '已单独停止' },
      { index: 2, title: 'C', status: 'failed', reason: 'error', steps: 1, detail: 'boom' },
    ]);
    expect(text).toContain('1/3 tasks succeeded');
    expect(text).toContain('### 2. B — 已停止');
    expect(text).toContain('### 3. C — 失败');
  });
});
