import { Notification } from 'electron';
import { getAppIcon } from './window';
import { nanoid } from 'nanoid';
import type { SessionStore } from '../shared/chat';
import { loadSkills } from './skills';
import { markHeadlessSession, unmarkHeadlessSession } from './server/agent/permissions';
import { runChatTurn } from './server/agent/runtime';
import { abortChatTurn } from './server/agent/session';
import type { ScheduleStore } from './server/storage/scheduleStore';
import type { SettingsStore } from './server/storage/settingsStore';
import type { UsageStore } from './server/storage/usageStore';
import type { Schedule } from '../shared/schedule';
import { parseStreamLine } from '../shared/stream';

export class ScheduledRunInterruptedError extends Error { constructor(message: string) { super(message); this.name = 'ScheduledRunInterruptedError'; } }

export async function requireScheduledCompletion(response: Response): Promise<void> {
  let terminal: Extract<import('../shared/stream').ChatStreamEvent, { type: 'done' }> | undefined;
  for (const line of (await response.text()).split('\n')) {
    const event = parseStreamLine(line);
    if (event?.type === 'done') terminal = event;
  }
  if (!terminal) throw new ScheduledRunInterruptedError('自动化响应中断，未收到任务完成信号');
  if (terminal.outcome === 'interrupted') throw new ScheduledRunInterruptedError(terminal.error || '自动化任务中断，结果尚未确认');
  if (terminal.outcome !== 'completed') throw new Error(terminal.error || '自动化任务失败');
}

export function startScheduler(options: {
  dataRoot: string;
  scheduleStore: ScheduleStore;
  settingsStore: SettingsStore;
  skillsDirs: string[];
  sessionStore: SessionStore;
  usageStore?: UsageStore;
}): (() => Promise<void>) & { ready: Promise<void> } {
  const sessionStore = options.sessionStore;
  /** Schedules currently mid-fire — one stuck run can never starve the rest. */
  const inflight = new Set<string>();
  const liveSessions = new Set<string>();
  let stopping = false;
  let stopped: Promise<void> | undefined;

  async function fire(due: Schedule): Promise<void> {
    let sessionId: string | undefined;
    const executionId = `schedule-run:${nanoid()}`;
    const schedule = await options.scheduleStore.claimRun(due.id, executionId);
    if (!schedule) return;
    try {
      if (stopping) throw new ScheduledRunInterruptedError('应用正在退出，执行已暂停，未自动重提');
      const settings = await options.settingsStore.get();
      const session = await sessionStore.create(schedule.name, settings.workspacePath);
      sessionId = session.id;
      if (!await options.scheduleStore.attachSession(schedule.id, executionId, session.id)) return;
      liveSessions.add(session.id);
      markHeadlessSession(session.id);
      const skills = await loadSkills(options.skillsDirs);
      const skill = schedule.skillId ? skills.find((item) => item.id === schedule.skillId) ?? null : null;
      if (skill?.contract) throw new Error('此创作技能需要画布交付执行器，当前自动化尚未接入。请在创作会话中运行。');
      if (stopping) throw new ScheduledRunInterruptedError('应用正在退出，结果尚未确认，请查看关联会话');
      const response = await runChatTurn({
        sessionStore,
        settingsStore: options.settingsStore,
        sessionId: session.id,
        userText: schedule.prompt,
        skill,
        scheduleStore: options.scheduleStore,
        dataRoot: options.dataRoot,
        usageStore: options.usageStore,
        // Saved before the ceiling existed → workspace; "inherit" is the explicit opt-in to the global mode.
        runCeiling: (schedule.runPermission ?? 'workspace') === 'inherit' ? undefined : (schedule.runPermission ?? 'workspace'),
      });
      if (stopping) { abortChatTurn(session.id); throw new ScheduledRunInterruptedError('应用正在退出，执行已中断，结果尚未确认'); }
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      await requireScheduledCompletion(response);
      const accepted = await options.scheduleStore.finishExecution(schedule.id, executionId, 'succeeded', null);
      if (!accepted) return;
      try {
        new Notification({ title: 'Reizo 自动化', body: schedule.name, icon: getAppIcon() }).show();
      } catch {
        /* ignore */
      }
    } catch (err) {
      await options.scheduleStore.finishExecution(schedule.id, executionId, stopping || err instanceof ScheduledRunInterruptedError ? 'interrupted' : 'failed', err instanceof Error ? err.message : String(err));
      // A schedule that just paused itself must not fail silently — the user has to know it stopped.
      const after = (await options.scheduleStore.list()).find((item) => item.id === schedule.id);
      if (after?.autoPausedAt && Date.now() - Date.parse(after.autoPausedAt) < 10_000) {
        try {
          new Notification({ title: 'Reizo 自动化已暂停', body: `「${schedule.name}」${after.lastError ?? '连续失败，已自动暂停'}`, icon: getAppIcon() }).show();
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (sessionId) { liveSessions.delete(sessionId); unmarkHeadlessSession(sessionId); }
    }
  }

  async function tick(): Promise<void> {
    if (stopping) return;
    const due = await options.scheduleStore.due();
    for (const schedule of due) {
      if (stopping) return;
      if (inflight.has(schedule.id)) continue;
      inflight.add(schedule.id);
      void fire(schedule).catch(() => console.warn('[scheduler] run outcome could not be persisted')).finally(() => inflight.delete(schedule.id));
    }
  }

  const timer = setInterval(() => {
    void tick().catch(() => console.warn('[scheduler] schedules could not be read'));
  }, 20_000);
  const ready = options.scheduleStore.interruptActive().then(() => tick());
  void ready.catch(() => console.warn('[scheduler] recovery failed; existing records were retained'));
  return Object.assign(() => {
    if (stopped) return stopped;
    stopping = true; clearInterval(timer);
    for (const sessionId of liveSessions) abortChatTurn(sessionId);
    stopped = ready.catch((): void => undefined).then(async () => { await options.scheduleStore.interruptActive('应用退出时执行尚未确认，已暂停；请先查看关联会话，再手动决定是否重试'); });
    return stopped;
  }, { ready });
}
