import { Notification } from 'electron';
import { loadSkills } from './skills';
import { runChatTurn } from './server/agent/runtime';
import { createFileSessionStore } from './server/storage/fileSessionStore';
import type { ScheduleStore } from './server/storage/scheduleStore';
import type { SettingsStore } from './server/storage/settingsStore';
import type { Schedule } from '../shared/schedule';

export function startScheduler(options: {
  dataRoot: string;
  scheduleStore: ScheduleStore;
  settingsStore: SettingsStore;
  skillsDirs: string[];
}): () => void {
  const sessionStore = createFileSessionStore(options.dataRoot);
  let running = false;

  async function fire(schedule: Schedule): Promise<void> {
    try {
      const settings = await options.settingsStore.get();
      const session = await sessionStore.create(schedule.name, settings.workspacePath);
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
      await options.scheduleStore.markRun(schedule.id, null);
      try {
        new Notification({ title: 'Reizo 自动化', body: schedule.name }).show();
      } catch {
        /* ignore */
      }
    } catch (err) {
      await options.scheduleStore.markRun(schedule.id, err instanceof Error ? err.message : String(err));
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const due = await options.scheduleStore.due();
      for (const schedule of due) await fire(schedule);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, 20_000);
  void tick();
  return () => clearInterval(timer);
}
