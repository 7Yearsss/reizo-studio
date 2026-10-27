import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { createEventBatcher, isPartialFile, matchesPattern } from '../shared/folderTrigger';
import type { ScheduleStore } from './server/storage/scheduleStore';
import type { SettingsStore } from './server/storage/settingsStore';

interface Active { key: string; close: () => void }

export interface FolderTriggerOptions {
  scheduleStore: ScheduleStore;
  settingsStore: Pick<SettingsStore, 'get'>;
  /** A run was requested; check for due schedules now. */
  onRequested: () => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
}

/**
 * Starts a run of an automation when files land in the folder it watches. The folder is workspace-relative and is
 * resolved against the current workspace, so an unattended run is only ever told about files it is allowed to read.
 * Events are batched: a burst of files is one run that lists them all. If the automation is busy the files are kept
 * and offered again shortly, never dropped.
 */
export function startFolderTriggers(options: FolderTriggerOptions) {
  const active = new Map<string, Active>();
  const debounceMs = options.debounceMs ?? 3000;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const retryMs = options.retryMs ?? 15_000;
  let stopped = false;

  async function attach(scheduleId: string, workspace: string, folder: string, pattern: string | undefined): Promise<Active | null> {
    const root = path.resolve(workspace);
    const dir = path.resolve(root, folder);
    if (dir !== root && !dir.startsWith(root + path.sep)) return null;
    if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) return null;

    let retries = 0;
    const batcher = createEventBatcher({
      debounceMs,
      maxWaitMs,
      onFire: ({ paths }) => {
        void options.scheduleStore.requestRun(scheduleId, `watch:${nanoid()}`, paths).then(
          () => { retries = 0; options.onRequested(); },
          () => {
            // Busy or gone: keep the files and offer them again, a few times.
            if (stopped || retries >= 20) return;
            retries += 1;
            setTimeout(() => { if (!stopped) paths.forEach((p) => batcher.add(p)); }, retryMs);
          },
        );
      },
    });
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const inside = String(filename).replace(/\\/g, '/');
        if (isPartialFile(inside) || !matchesPattern(inside, pattern)) return;
        batcher.add(path.relative(root, path.join(dir, inside)).replace(/\\/g, '/'));
      });
    } catch {
      return null;
    }
    watcher.on('error', () => undefined);
    return { key: '', close: () => { watcher.close(); batcher.cancel(); } };
  }

  /** Make the set of watchers match the enabled folder automations. */
  async function sync(): Promise<void> {
    if (stopped) return;
    const workspace = (await options.settingsStore.get()).workspacePath;
    const wanted = new Map<string, { id: string; folder: string; pattern?: string }>();
    if (workspace) {
      for (const schedule of await options.scheduleStore.list()) {
        if (!schedule.watch || !schedule.enabled) continue;
        wanted.set(`${schedule.id}|${workspace}|${schedule.watch.folder}|${schedule.watch.pattern ?? ''}`, { id: schedule.id, ...schedule.watch });
      }
    }
    for (const [key, entry] of active) {
      if (!wanted.has(key)) { entry.close(); active.delete(key); }
    }
    for (const [key, w] of wanted) {
      if (active.has(key) || !workspace) continue;
      const made = await attach(w.id, workspace, w.folder, w.pattern);
      if (made) active.set(key, { ...made, key });
    }
  }

  return {
    sync,
    activeCount: () => active.size,
    stop(): void {
      stopped = true;
      for (const entry of active.values()) entry.close();
      active.clear();
    },
  };
}
