import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SkillHistoryEntry {
  /** Snapshot file name inside `.history/`. */
  file: string;
  at: string;
  reason: string;
}

const MAX_SNAPSHOTS = 50;

function historyDir(skillDir: string): string { return path.join(skillDir, '.history'); }

/** Keep the content a write is about to replace, so the change can be undone. */
export async function snapshotSkill(skillDir: string, content: string, reason: string): Promise<SkillHistoryEntry> {
  const dir = historyDir(skillDir);
  await mkdir(dir, { recursive: true });
  const at = new Date().toISOString();
  const file = `${at.replace(/[:.]/g, '-')}.md`;
  await writeFile(path.join(dir, file), content, 'utf8');
  const entry: SkillHistoryEntry = { file, at, reason };
  await appendFile(path.join(dir, 'index.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  await prune(dir);
  return entry;
}

async function prune(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  if (files.length <= MAX_SNAPSHOTS) return;
  const { unlink } = await import('node:fs/promises');
  for (const name of files.slice(0, files.length - MAX_SNAPSHOTS)) await unlink(path.join(dir, name)).catch((): void => undefined);
}

/** Newest first; entries whose snapshot file is gone are dropped. */
export async function listSkillHistory(skillDir: string): Promise<SkillHistoryEntry[]> {
  let raw = '';
  try { raw = await readFile(path.join(historyDir(skillDir), 'index.jsonl'), 'utf8'); } catch { return []; }
  const present = new Set((await readdir(historyDir(skillDir)).catch(() => [] as string[])));
  const entries: SkillHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as SkillHistoryEntry;
      if (typeof entry.file === 'string' && present.has(entry.file)) entries.push(entry);
    } catch { /* skip a torn line */ }
  }
  return entries.reverse();
}

export async function readSkillSnapshot(skillDir: string, file: string): Promise<string | null> {
  if (file !== path.basename(file) || !file.endsWith('.md')) return null;
  try { return await readFile(path.join(historyDir(skillDir), file), 'utf8'); } catch { return null; }
}
