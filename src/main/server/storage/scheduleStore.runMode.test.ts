import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createScheduleStore } from './scheduleStore';
import { createThoughtStore } from './thoughtStore';
import { createSchedulesRouter } from '../routes/schedules';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'reizo-schedule-mode-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('defaults to a new conversation per run and accepts a persistent one', async () => {
  const store = createScheduleStore(root);
  const fresh = await store.create({ name: 'a', prompt: 'p', intervalMs: 60_000 });
  const keeping = await store.create({ name: 'b', prompt: 'p', intervalMs: 60_000, runMode: 'persistent' });
  expect(fresh.runMode).toBeUndefined();
  expect(keeping.runMode).toBe('persistent');
});

it('rejects an unknown run mode', async () => {
  const store = createScheduleStore(root);
  await expect(store.create({ name: 'a', prompt: 'p', intervalMs: 60_000, runMode: 'sideways' as never })).rejects.toThrow('运行方式');
});

it('remembers the bound conversation and can forget it', async () => {
  const store = createScheduleStore(root);
  const s = await store.create({ name: 'a', prompt: 'p', intervalMs: 60_000, runMode: 'persistent' });
  expect(await store.bindSession(s.id, 'session:1')).toBe(true);
  expect((await store.list())[0].boundSessionId).toBe('session:1');
  await store.bindSession(s.id, null);
  expect((await store.list())[0].boundSessionId).toBeUndefined();
  expect(await store.bindSession('missing', 'x')).toBe(false);
});

it('the create route passes the run mode through', async () => {
  const store = createScheduleStore(root);
  const router = createSchedulesRouter(store, createThoughtStore(root));
  const response = await router.request('http://fixture/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'hello', intervalMs: 3_600_000, runMode: 'persistent' }) });
  expect(response.status).toBe(201);
  expect(((await response.json()) as { schedule: { runMode?: string } }).schedule.runMode).toBe('persistent');
});
