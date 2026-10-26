import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScheduleStore } from '../storage/scheduleStore';
import {
  ALWAYS_ASK_TOOLS,
  answerPermission,
  consumeInteractions,
  needsApproval,
  requestPermission,
  resetPermissionsForTests,
} from './permissions';
import { createScheduleTools, runApprovedScheduleTool } from './scheduleTools';

afterEach(() => resetPermissionsForTests());

describe('self-extension tools always ask', () => {
  it('locks the list', () => {
    expect([...ALWAYS_ASK_TOOLS].sort()).toEqual(['create_schedule', 'delete_schedule']);
  });

  it('even full mode asks, and allow-session never becomes a standing grant', async () => {
    for (const name of ALWAYS_ASK_TOOLS) expect(needsApproval('full', name)).toBe(true);
    expect(await requestPermission({ sessionId: 's', toolCallId: 'c1', name: 'create_schedule', args: {}, mode: 'full' })).toBe(false);
    answerPermission('c1', 'allow-session');
    consumeInteractions('s');
    expect(await requestPermission({ sessionId: 's', toolCallId: 'c2', name: 'create_schedule', args: {}, mode: 'full' })).toBe(false);
  });

  it('create_schedule in full mode records a pending card and writes nothing; approving then runs it', async () => {
    const store = createScheduleStore(mkdtempSync(path.join(os.tmpdir(), 'reizo-ask-')));
    const tools = createScheduleTools({ scheduleStore: store, sessionId: 's', permissionMode: 'full' });
    await expect((tools.create_schedule.execute as any)({ prompt: '每天删库', intervalMinutes: 60 }, { toolCallId: 't1' })).rejects.toThrow('__REIZO_INTERACTION_REQUIRED__');
    expect(await store.list()).toEqual([]);
    answerPermission('t1', 'allow');
    const [item] = consumeInteractions('s');
    expect(item.decision).toBe('allow');
    const out = await runApprovedScheduleTool(store, 's', item.name, item.args, item.toolCallId);
    expect(out.error).toBeUndefined();
    expect((await store.list())).toHaveLength(1);
  });

  it('a denied call leaves nothing on disk', async () => {
    const store = createScheduleStore(mkdtempSync(path.join(os.tmpdir(), 'reizo-ask-')));
    const tools = createScheduleTools({ scheduleStore: store, sessionId: 's', permissionMode: 'full' });
    await expect((tools.delete_schedule.execute as any)({ id: 'x' }, { toolCallId: 't2' })).rejects.toThrow('__REIZO_INTERACTION_REQUIRED__');
    answerPermission('t2', 'deny');
    expect((consumeInteractions('s'))[0].decision).toBe('deny');
    expect(await store.list()).toEqual([]);
  });
});
