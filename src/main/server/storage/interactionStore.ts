import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PendingInteractionInfo } from '../agent/permissions';

export interface PersistedInteraction extends PendingInteractionInfo {
  sessionId: string;
}

/**
 * Unanswered ask/permission cards persisted to disk so an app restart does not
 * silently drop a question the user never saw answered. Answered or consumed
 * entries are removed on the next write — the file only holds live cards.
 */
export function createInteractionStore(root: string) {
  const file = path.join(root, 'interactions.json');
  let cache: PersistedInteraction[] | null = null;

  async function load(): Promise<PersistedInteraction[]> {
    if (cache) return cache;
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      cache = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      cache = [];
    }
    return cache;
  }

  return {
    async list(): Promise<PersistedInteraction[]> {
      return [...(await load())];
    },

    async setAll(items: PersistedInteraction[]): Promise<void> {
      cache = [...items];
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(items, null, 2), 'utf8');
    },

    async clear(): Promise<void> {
      cache = [];
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '[]', 'utf8');
    },
  };
}

export type InteractionStore = ReturnType<typeof createInteractionStore>;
