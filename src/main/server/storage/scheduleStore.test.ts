import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScheduleStore } from './scheduleStore';
import { createThoughtStore } from './thoughtStore';
import { createSchedulesRouter } from '../routes/schedules';

describe('automation interval validation', () => {
  it('rejects unsafe API/store intervals without changing valid schedules or running invalid legacy data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reizo-schedule-validation-'));
    try {
      const store = createScheduleStore(root);
      const router = createSchedulesRouter(store, createThoughtStore(root));
      const valid = await store.create({ name: 'valid', prompt: 'offline fixture', intervalMs: 60_000 });
      for (const intervalMs of [-1, 0, 59_999, null, '60000']) {
        const response = await router.request('http://fixture/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'invalid fixture', intervalMs }) });
        expect(response.status).toBe(400);
      }
      for (const intervalMs of [NaN, Infinity, 59_999, -1]) {
        await expect(store.create({ name: 'invalid', prompt: 'fixture', intervalMs })).rejects.toThrow('至少 60 秒');
        await expect(store.update(valid.id, { intervalMs })).rejects.toThrow('至少 60 秒');
      }
      const patched = await router.request(`http://fixture/${valid.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intervalMs: 1 }) });
      expect(patched.status).toBe(400);
      expect(await store.list()).toEqual([valid]);
      const disk = JSON.parse(await readFile(path.join(root, 'schedules.json'), 'utf8'));
      disk.schedules.push({ ...valid, id: 'legacy-invalid', intervalMs: -1, nextRunAt: new Date(0).toISOString() });
      await writeFile(path.join(root, 'schedules.json'), JSON.stringify(disk));
      expect((await store.due(Date.now() + 120_000)).map((item) => item.id)).toEqual([valid.id]);
    } finally {
      if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('reizo-schedule-validation-')) await rm(root, { recursive: true, force: true });
      else console.warn('Fixture kept because its cleanup boundary could not be verified');
    }
  });

  it('replays creation/run requests, keeps deletion tombstones and pauses recovered execution before a paid retry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reizo-schedule-validation-'));
    try {
      let store = createScheduleStore(root);
      const input = { name: 'recoverable', prompt: 'offline fixture', intervalMs: 60_000, once: true, operationId: 'create:stable' };
      const [first, duplicate] = await Promise.all([store.create(input), store.create(input)]);
      expect(duplicate.id).toBe(first.id); expect(await store.list()).toHaveLength(1);
      await expect(store.create({ ...input, prompt: 'changed input' })).rejects.toThrow('不同');
      await store.update(first.id, { enabled: false });
      const router = createSchedulesRouter(store, createThoughtStore(root));
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await router.request(`http://fixture/${first.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'run:stable' }) });
        expect(response.status).toBe(200);
        expect((await response.json()).schedule.pendingRun.operationId).toBe('run:stable');
      }
      const claimed = await store.claimRun(first.id, 'execution:first');
      expect(claimed?.activeExecution?.kind).toBe('manual');
      expect(await store.claimRun(first.id, 'execution:duplicate')).toBeNull();
      await store.attachSession(first.id, 'execution:first', 'session:first');
      store = createScheduleStore(root); // A new process sees the durable active marker.
      expect(await store.interruptActive()).toBe(1);
      let [recovered] = await store.list();
      expect(recovered.lastOutcome).toBe('interrupted'); expect(recovered.enabled).toBe(false);
      expect(recovered.lastSessionId).toBe('session:first'); expect(recovered.lastExecutionId).toBe('execution:first');
      expect(await store.due(Date.now() + 300_000)).toEqual([]);
      await store.requestRun(first.id, 'run:stable'); // Lost-response replay never re-submits the claimed execution.
      expect(await store.due(Date.now() + 300_000)).toEqual([]);
      expect(await store.finishExecution(first.id, 'execution:first', 'succeeded', null)).toBe(false);
      await store.requestRun(first.id, 'run:explicit-retry');
      await store.claimRun(first.id, 'execution:retry');
      await store.attachSession(first.id, 'execution:retry', 'session:retry');
      await store.finishExecution(first.id, 'execution:retry', 'failed', 'verified failure');
      [recovered] = await store.list();
      expect(recovered.enabled).toBe(false); expect(recovered.lastError).toBe('verified failure'); expect(recovered.runCount).toBe(2);
      expect(recovered.lastSessionId).toBe('session:retry');
      await store.requestRun(first.id, 'run:before-session');
      await store.claimRun(first.id, 'execution:before-session');
      await store.interruptActive();
      expect((await store.list())[0].lastSessionId).toBeUndefined();
      await store.remove(first.id);
      await expect(store.create(input)).rejects.toThrow('已删除');
      await expect(store.requestRun(first.id, 'run:stable')).rejects.toThrow('已删除');
      expect(await store.list()).toEqual([]);
    } finally {
      if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('reizo-schedule-validation-')) await rm(root, { recursive: true, force: true });
      else console.warn('Fixture kept because its cleanup boundary could not be verified');
    }
  });
});
