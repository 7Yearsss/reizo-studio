import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Schedule } from '../shared/schedule';
import { createScheduleStore } from './server/storage/scheduleStore';
import { requireScheduledCompletion, ScheduledRunInterruptedError, startScheduler } from './schedulerHost';

const harness = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('electron', () => ({ Notification: class { show() { /* No native notification in fixtures. */ } } }));
vi.mock('./server/agent/runtime', () => ({ runChatTurn: harness.run }));
vi.mock('./skills', () => ({ loadSkills: async (): Promise<[]> => [] }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const terminal = (outcome: string, error?: string) => new Response(`${JSON.stringify({ type: 'done', outcome, ...(error ? { error } : {}) })}\n`);

describe('durable automation execution', () => {
  let root: string;
  let store: ReturnType<typeof createScheduleStore>;
  const stops: Array<ReturnType<typeof startScheduler>> = [];
  const options = () => ({ dataRoot: root, scheduleStore: store, skillsDirs: [] as string[],
    settingsStore: { get: async () => ({ workspacePath: null as string | null }) } as unknown as Parameters<typeof startScheduler>[0]['settingsStore'],
    sessionStore: { create: async () => ({ id: 'fixture-session', title: 'fixture' }) } as unknown as Parameters<typeof startScheduler>[0]['sessionStore'],
  });
  beforeEach(async () => { harness.run.mockReset(); root = await mkdtemp(path.join(tmpdir(), 'reizo-scheduler-recovery-')); store = createScheduleStore(root); });
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
    if (path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('reizo-scheduler-recovery-')) await rm(root, { recursive: true, force: true });
  });

  it('persists claim/session before the provider and preserves interruption against a late success and restart', async () => {
    const schedule = await store.create({ name: 'fixture', prompt: 'offline', intervalMs: 60_000, operationId: 'create' });
    await store.update(schedule.id, { enabled: false });
    await store.requestRun(schedule.id, 'manual');
    const observed = deferred<Schedule>(); const response = deferred<Response>(); const finished = deferred<boolean>();
    harness.run.mockImplementation(async () => { observed.resolve((await store.list())[0]); return response.promise; });
    const originalFinish = store.finishExecution.bind(store);
    vi.spyOn(store, 'finishExecution').mockImplementation(async (...args) => { const accepted = await originalFinish(...args); finished.resolve(accepted); return accepted; });
    const usageStore = {} as NonNullable<Parameters<typeof startScheduler>[0]['usageStore']>;
    const stop = startScheduler({ ...options(), usageStore }); stops.push(stop);
    const beforeProvider = await observed.promise;
    expect(beforeProvider.activeExecution?.id).toBe(beforeProvider.lastExecutionId);
    expect(beforeProvider.activeExecution?.sessionId).toBe('fixture-session');
    expect(harness.run.mock.calls[0][0].usageStore).toBe(usageStore);
    expect(harness.run.mock.calls[0][0].canvasStore).toBeUndefined();
    await stop();
    expect((await store.list())[0]).toMatchObject({ lastOutcome: 'interrupted', enabled: false, lastSessionId: 'fixture-session', runCount: 1 });
    response.resolve(terminal('completed'));
    expect(await finished.promise).toBe(false);
    const restarted = startScheduler(options()); stops.push(restarted); await restarted.ready;
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect((await store.list())[0].lastOutcome).toBe('interrupted');
  });

  it('a persistent automation keeps writing to one conversation, and opens a new one if that was deleted', async () => {
    const schedule = await store.create({ name: 'fixture', prompt: 'offline', intervalMs: 60_000, runMode: 'persistent' });
    const created: string[] = [];
    const known = new Set<string>();
    const sessionStore = {
      create: async () => { const id = `session-${created.length + 1}`; created.push(id); known.add(id); return { id, title: 'fixture' }; },
      get: async (id: string) => (known.has(id) ? { id } : null),
    } as unknown as Parameters<typeof startScheduler>[0]['sessionStore'];
    harness.run.mockImplementation(async () => terminal('completed'));
    let n = 0;
    const runOnce = async (): Promise<void> => {
      await store.requestRun(schedule.id, `manual-${++n}`);
      const done = deferred<boolean>();
      const original = store.finishExecution.bind(store);
      const spy = vi.spyOn(store, 'finishExecution').mockImplementation(async (...args) => { const ok = await original(...args); done.resolve(ok); return ok; });
      const stop = startScheduler({ ...options(), sessionStore }); stops.push(stop);
      await done.promise; await stop(); spy.mockRestore();
    };
    await runOnce();
    await runOnce();
    expect(created).toEqual(['session-1']);
    expect(harness.run.mock.calls.map((call) => call[0].sessionId)).toEqual(['session-1', 'session-1']);
    known.clear();
    await runOnce();
    expect(created).toEqual(['session-1', 'session-2']);
    expect((await store.list())[0].boundSessionId).toBe('session-2');
  });

  it('keeps a failed one-shot and accepts only a completed terminal marker', async () => {
    const schedule = await store.create({ name: 'fixture', prompt: 'offline', intervalMs: 60_000, once: true });
    await store.requestRun(schedule.id, 'manual');
    const finished = deferred<boolean>();
    harness.run.mockResolvedValue(terminal('error', 'verified failure'));
    const originalFinish = store.finishExecution.bind(store);
    vi.spyOn(store, 'finishExecution').mockImplementation(async (...args) => { const accepted = await originalFinish(...args); finished.resolve(accepted); return accepted; });
    const stop = startScheduler(options()); stops.push(stop);
    expect(await finished.promise).toBe(true);
    expect((await store.list())[0]).toMatchObject({ id: schedule.id, lastOutcome: 'failed', lastError: 'verified failure', enabled: false, runCount: 1, lastSessionId: 'fixture-session' });
    await expect(requireScheduledCompletion(new Response(''))).rejects.toBeInstanceOf(ScheduledRunInterruptedError);
    await expect(requireScheduledCompletion(terminal('interrupted'))).rejects.toBeInstanceOf(ScheduledRunInterruptedError);
    await expect(requireScheduledCompletion(terminal('completed'))).resolves.toBeUndefined();
  });
});
