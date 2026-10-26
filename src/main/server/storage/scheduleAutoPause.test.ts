import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_CONSECUTIVE_FAILURES, MAX_RUN_HISTORY } from '../../../shared/schedule';
import { createScheduleStore } from './scheduleStore';

describe('schedule auto-pause', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'reizo-autopause-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function run(store: ReturnType<typeof createScheduleStore>, id: string, n: number, outcome: 'succeeded' | 'failed') {
    await store.update(id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const claimed = await store.claimRun(id, `exec-${n}-${outcome}`);
    expect(claimed).not.toBeNull();
    await store.finishExecution(id, `exec-${n}-${outcome}`, outcome, outcome === 'failed' ? 'boom' : null);
  }

  it('pauses after consecutive failures and says why', async () => {
    const store = createScheduleStore(root);
    const s = await store.create({ name: 'daily report', prompt: 'x', intervalMs: 60_000 });
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) await run(store, s.id, i, 'failed');
    const after = (await store.list())[0];
    expect(after.enabled).toBe(false);
    expect(after.autoPausedAt).toBeTruthy();
    expect(after.lastError).toContain(`连续失败 ${MAX_CONSECUTIVE_FAILURES} 次`);
  });

  it('a success resets the streak, and re-enabling clears the pause', async () => {
    const store = createScheduleStore(root);
    const s = await store.create({ name: 'weekly', prompt: 'x', intervalMs: 60_000 });
    await run(store, s.id, 0, 'failed');
    await run(store, s.id, 1, 'failed');
    await run(store, s.id, 2, 'succeeded');
    await run(store, s.id, 3, 'failed');
    expect((await store.list())[0].enabled).toBe(true);
    expect((await store.list())[0].consecutiveFailures).toBe(1);
    await run(store, s.id, 4, 'failed');
    await run(store, s.id, 5, 'failed');
    expect((await store.list())[0].enabled).toBe(false);
    await store.update(s.id, { enabled: true });
    const resumed = (await store.list())[0];
    expect(resumed.enabled).toBe(true);
    expect(resumed.consecutiveFailures).toBe(0);
    expect(resumed.autoPausedAt).toBeUndefined();
  });

  it('a cadence schedule lands on the wall-clock time, before and after a run', async () => {
    const store = createScheduleStore(root);
    const s = await store.create({ name: 'standup', prompt: 'x', intervalMs: 24 * 3_600_000, cadence: { kind: 'weekdays', hour: 9, minute: 30 } });
    const next = new Date(s.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect([next.getHours(), next.getMinutes()]).toEqual([9, 30]);
    expect([0, 6]).not.toContain(next.getDay());
    await run(store, s.id, 0, 'succeeded');
    const after = new Date((await store.list())[0].nextRunAt);
    expect([after.getHours(), after.getMinutes()]).toEqual([9, 30]);
    expect([0, 6]).not.toContain(after.getDay());
    await expect(store.create({ name: 'bad', prompt: 'x', intervalMs: 24 * 3_600_000, cadence: { kind: 'weekly', hour: 9, minute: 0 } })).rejects.toThrow('运行时间无效');
  });

  it('keeps a capped run history, newest first', async () => {
    const store = createScheduleStore(root);
    const s = await store.create({ name: 'history', prompt: 'x', intervalMs: 60_000 });
    for (let i = 0; i < MAX_RUN_HISTORY + 3; i++) await run(store, s.id, i, 'succeeded');
    const runs = (await store.list())[0].runs ?? [];
    expect(runs).toHaveLength(MAX_RUN_HISTORY);
    expect(runs[0].executionId).toBe(`exec-${MAX_RUN_HISTORY + 2}-succeeded`);
    expect(runs[0].outcome).toBe('succeeded');
  });
});
