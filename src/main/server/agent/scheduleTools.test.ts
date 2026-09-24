import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduleStore } from '../storage/scheduleStore';
import { createScheduleTools, MIN_INTERVAL_MS } from './scheduleTools';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-sched-'));
  const scheduleStore = createScheduleStore(dir);
  const tools = createScheduleTools({ scheduleStore });
  return { scheduleStore, tools };
}

describe('scheduleTools', () => {
  it('create_schedule persists a recurring schedule', async () => {
    const { scheduleStore, tools } = setup();
    const out = await (tools.create_schedule.execute as any)({
      prompt: '每小时汇总一次未读会话',
      intervalMinutes: 60,
      name: '会话巡检',
    });
    expect(out.ok).toBe(true);
    const [saved] = await scheduleStore.list();
    expect(saved).toBeDefined();
    expect(saved!.name).toBe('会话巡检');
    expect(saved!.intervalMs).toBe(60 * 60_000);
    expect(saved!.enabled).toBe(true);
    expect(saved!.once).toBeUndefined();
  });

  it('clamps intervalMinutes to the minimum interval', async () => {
    const { scheduleStore, tools } = setup();
    await (tools.create_schedule.execute as any)({ prompt: 'x', intervalMinutes: 0.01 });
    const [saved] = await scheduleStore.list();
    expect(saved!.intervalMs).toBe(MIN_INTERVAL_MS);
  });

  it('defaults the name to the truncated prompt', async () => {
    const { scheduleStore, tools } = setup();
    await (tools.create_schedule.execute as any)({ prompt: '提醒我检查那个跑了很久的任务进度', intervalMinutes: 30 });
    const [saved] = await scheduleStore.list();
    expect(saved!.name).toBe('提醒我检查那个跑了很久的任务进度'.slice(0, 60));
  });

  it('marks once:true schedules as one-shot', async () => {
    const { scheduleStore, tools } = setup();
    await (tools.create_schedule.execute as any)({ prompt: '半小时后看一眼', intervalMinutes: 30, once: true });
    const [saved] = await scheduleStore.list();
    expect(saved!.once).toBe(true);
  });

  it('list_schedules returns created items', async () => {
    const { tools } = setup();
    await (tools.create_schedule.execute as any)({ prompt: 'a', intervalMinutes: 10 });
    const out = await (tools.list_schedules.execute as any)({});
    expect(out.schedules).toHaveLength(1);
    expect(out.schedules[0].prompt).toBe('a');
  });

  it('delete_schedule removes the item', async () => {
    const { scheduleStore, tools } = setup();
    const out = await (tools.create_schedule.execute as any)({ prompt: 'a', intervalMinutes: 10 });
    await (tools.delete_schedule.execute as any)({ id: out.schedule.id });
    expect(await scheduleStore.list()).toHaveLength(0);
  });

  it('due() picks up a once schedule after its delay, and remove clears it', async () => {
    const { scheduleStore, tools } = setup();
    await (tools.create_schedule.execute as any)({ prompt: 'a', intervalMinutes: 1, once: true });
    const dueSoon = await scheduleStore.due(Date.now() + 2 * MIN_INTERVAL_MS);
    expect(dueSoon).toHaveLength(1);
    await scheduleStore.remove(dueSoon[0]!.id);
    expect(await scheduleStore.due(Date.now() + 2 * MIN_INTERVAL_MS)).toHaveLength(0);
  });
});
