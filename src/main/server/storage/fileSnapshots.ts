import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { writeTextAtomic } from './atomicFile';

/**
 * One snapshot per agent write: the file as it was just before (or "did not exist"), so the user can undo exactly that
 * change later. Kept per conversation, newest 200 only; this is an undo aid, not a version-control system.
 */
export interface FileSnapshot {
  id: string;
  path: string;
  /** False when the agent created the file: rolling back deletes it. */
  existed: boolean;
  before: string;
  /** SHA-256 of what the agent wrote, to tell whether the file changed again since. */
  afterHash: string;
  at: string;
}

const KEEP = 200;
const safe = (value: string): string => value.replace(/[^\w-]/g, '_');
export const hashContent = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

export function createFileSnapshotStore(dataRoot: string) {
  const dirOf = (sessionId: string): string => path.join(dataRoot, 'snapshots', safe(sessionId));

  async function prune(dir: string): Promise<void> {
    const names = (await readdir(dir).catch((): string[] => [])).filter((n) => n.endsWith('.json'));
    if (names.length <= KEEP) return;
    const dated = await Promise.all(names.map(async (n) => ({ n, t: (await stat(path.join(dir, n)).catch((): null => null))?.mtimeMs ?? 0 })));
    for (const { n } of dated.sort((a, b) => a.t - b.t).slice(0, names.length - KEEP)) await rm(path.join(dir, n), { force: true });
  }

  return {
    async save(input: { sessionId: string; path: string; existed: boolean; before: string; after: string }): Promise<string> {
      const dir = dirOf(input.sessionId);
      await mkdir(dir, { recursive: true });
      const snapshot: FileSnapshot = { id: nanoid(10), path: input.path, existed: input.existed, before: input.before, afterHash: hashContent(input.after), at: new Date().toISOString() };
      await writeTextAtomic(path.join(dir, `${snapshot.id}.json`), JSON.stringify(snapshot));
      void prune(dir);
      return snapshot.id;
    },
    async get(sessionId: string, id: string): Promise<FileSnapshot | null> {
      if (id !== safe(id)) return null;
      try { return JSON.parse(await readFile(path.join(dirOf(sessionId), `${id}.json`), 'utf8')) as FileSnapshot; } catch { return null; }
    },
    async remove(sessionId: string, id: string): Promise<void> {
      if (id === safe(id)) await rm(path.join(dirOf(sessionId), `${id}.json`), { force: true });
    },
  };
}

export type FileSnapshotStore = ReturnType<typeof createFileSnapshotStore>;
