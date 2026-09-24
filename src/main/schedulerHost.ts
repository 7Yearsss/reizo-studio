import { Notification } from 'electron';
import type { SessionStore } from '../shared/chat';
import { loadSkills } from './skills';
import { markHeadlessSession, unmarkHeadlessSession } from './server/agent/permissions';
import { runChatTurn } from './server/agent/runtime';
import type { ScheduleStore } from './server/storage/scheduleStore';
import type { SettingsStore } from './server/storage/settingsStore';
import type { Schedule } from '../shared/schedule';

export function startScheduler(options: {
  dataRoot: string;
  scheduleStore: ScheduleStore;
  settingsStore: SettingsStore;
  skillsDirs: string[];
  sessionStore: SessionStore;
}): () => void {
  const sessionStore = options.sessionStore;
  /** Schedules currently mid-fire — one stuck run can never starve the rest. */
  const inflight = new Set<string>();

  async function fire(schedule: Schedule): Promise<void> {
    const settings = await options.settingsStore.get();
    const session = await sessionStore.create(schedule.name, settings.workspacePath);
    markHeadlessSession(session.id);
    try {
      const skills = await loadSkills(options.skillsDirs);
      const skill = schedule.skillId ? skills.find((item) => item.id === schedule.skillId) ?? null : null;
      const response = await runChatTurn({
        sessionStore,
        settingsStore: options.settingsStore,
        sessionId: session.id,
        userText: schedule.prompt,
        skill,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      await response.arrayBuffer();
      if (schedule.once) {
        await options.scheduleStore.remove(schedule.id);
      } else {
        await options.scheduleStore.markRun(schedule.id, null);
      }
      try {
        new Notification({ title: 'Reizo 自动化', body: schedule.name }).show();
      } catch {
        /* ignore */
      }
    } catch (err) {
      if (schedule.once) {
        await options.scheduleStore.remove(schedule.id);
      } else {
        await options.scheduleStore.markRun(schedule.id, err instanceof Error ? err.message : String(err));
      }
    } finally {
      unmarkHeadlessSession(session.id);
    }
  }

  async function tick(): Promise<void> {
    const due = await options.scheduleStore.due();
    for (const schedule of due) {
      if (inflight.has(schedule.id)) continue;
      inflight.add(schedule.id);
      void fire(schedule).finally(() => inflight.delete(schedule.id));
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, 20_000);
  void tick();
  return () => clearInterval(timer);
}
