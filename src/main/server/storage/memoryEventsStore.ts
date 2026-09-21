import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryEventRecord, MemoryItem } from '../../../shared/stream';

/**
 * Per-session log of memory activity (recall injections, extraction writes,
 * deletions) so the chat can re-render "已记住/想起了" rows after a reload —
 * they aren't part of the message stream itself.
 */

const CAP_PER_SESSION = 100;

export function createMemoryEventsStore(dataRoot: string) {
  const file = path.join(dataRoot, 'memory-events.json');
  let cache: Record<string, MemoryEventRecord[]> | null = null;

  async function load(): Promise<Record<string, MemoryEventRecord[]>> {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(file, 'utf8')) as Record<string, MemoryEventRecord[]>;
    } catch {
      cache = {};
    }
    return cache;
  }

  async function flush(): Promise<void> {
    if (!cache) return;
    await mkdir(dataRoot, { recursive: true });
    await writeFile(file, JSON.stringify(cache), 'utf8');
  }

  return {
    async list(sessionId: string): Promise<MemoryEventRecord[]> {
      return (await load())[sessionId] ?? [];
    },
    async append(
      sessionId: string,
      action: MemoryEventRecord['action'],
      items: MemoryItem[],
    ): Promise<MemoryEventRecord> {
      const all = await load();
      const record: MemoryEventRecord = {
        id: `me_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        action,
        items,
      };
      const list = all[sessionId] ?? [];
      list.push(record);
      all[sessionId] = list.slice(-CAP_PER_SESSION);
      await flush();
      return record;
    },
    /** Remove a file from prior 'wrote' records so undo survives a reload. */
    async markDeleted(sessionId: string, file: string): Promise<void> {
      const all = await load();
      const list = all[sessionId];
      if (!list) return;
      for (const record of list) {
        if (record.action === 'wrote') {
          record.items = record.items.filter((i) => i.file !== file);
        }
      }
      await flush();
    },
  };
}

export type MemoryEventsStore = ReturnType<typeof createMemoryEventsStore>;
