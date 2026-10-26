import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listWorkspaceDir, readWorkspaceText } from './workspaceFs';
import { writeWorkspaceFile } from './workspaceWrite';

/**
 * File-based memory, zcode-style: `<workspace>/memory/<slug>.md` per fact,
 * `<workspace>/MEMORY.md` as the one-line-per-entry index injected into the
 * system prompt each turn.
 */

export const MEMORY_DIR = 'memory';
const INDEX_FILE = 'MEMORY.md';
const INDEX_LINE = /^- \[([^\]]+)\]\(([^)]+)\)\s*(?:—\s*(.*))?$/;

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'lesson';

export interface MemoryEntry {
  fileName: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  /** File modification time; drives the "may be out of date" warning. */
  updatedAt?: string;
}

export interface MemoryManifestItem {
  fileName: string;
  name: string;
  description: string;
  type: MemoryType;
}

const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference', 'lesson'];

/**
 * Harness² D3: Tripwire against persisting raw credentials, private keys, or benchmark
 * contamination markers into workspace memory files (`memory/*.md` / `MEMORY.md`).
 */
const FORBIDDEN_MEMORY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: 'OpenAI/API secret key (sk-...)' },
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/, reason: 'Google API key (AIza...)' },
  { re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, reason: 'GitHub token (gh...)' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'PEM private key' },
  { re: /\b(?:ground_truth_score|eval_answer_key|benchmark_secret)\b/i, reason: 'forbidden evaluation marker' },
];

export function assertMemorySafe(text: string): void {
  for (const { re, reason } of FORBIDDEN_MEMORY_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`Refusing to persist unsafe memory content (${reason})`);
    }
  }
}

export function memoryFileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'memory'}.md`;
}

export function normalizeMemoryType(value: unknown): MemoryType {
  return (MEMORY_TYPES as string[]).includes(String(value)) ? (value as MemoryType) : 'project';
}

function parseFrontmatter(raw: string): { name: string; description: string; type: MemoryType; body: string } | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = m[1];
  const get = (key: string): string => {
    const hit = meta.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return hit ? hit[1].trim() : '';
  };
  const typeRaw = meta.match(/^ {2}type:\s*(\S+)/m)?.[1] ?? get('type');
  return {
    name: get('name'),
    description: get('description'),
    type: (MEMORY_TYPES as string[]).includes(typeRaw) ? (typeRaw as MemoryType) : 'project',
    body: m[2].trim(),
  };
}

function serializeEntry(entry: Omit<MemoryEntry, 'fileName'>): string {
  return [
    '---',
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    'metadata:',
    `  type: ${entry.type}`,
    '---',
    '',
    entry.body.trim(),
    '',
  ].join('\n');
}

function memoryDirPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, MEMORY_DIR);
}

async function ensureMemoryDir(workspaceRoot: string): Promise<void> {
  await fs.mkdir(memoryDirPath(workspaceRoot), { recursive: true });
}

/** List every memory file with its index metadata — the recall manifest. */
export async function listMemoryManifest(workspaceRoot: string): Promise<MemoryManifestItem[]> {
  try {
    const entries = await listWorkspaceDir(workspaceRoot, MEMORY_DIR);
    const items: MemoryManifestItem[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      try {
        const { content } = await readWorkspaceText(workspaceRoot, `${MEMORY_DIR}/${entry.name}`, 20_000);
        const parsed = parseFrontmatter(content);
        if (!parsed) continue;
        items.push({
          fileName: entry.name,
          name: parsed.name || entry.name.replace(/\.md$/, ''),
          description: parsed.description,
          type: parsed.type,
        });
      } catch {
        /* unreadable file — skip */
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function readMemoryEntry(workspaceRoot: string, fileName: string): Promise<MemoryEntry | null> {
  if (fileName.includes('/') || fileName.includes('..')) return null;
  try {
    const { content } = await readWorkspaceText(workspaceRoot, `${MEMORY_DIR}/${fileName}`, 50_000);
    const parsed = parseFrontmatter(content);
    if (!parsed) return null;
    const updatedAt = await fs.stat(path.join(memoryDirPath(workspaceRoot), fileName)).then((st) => st.mtime.toISOString(), (): undefined => undefined);
    return { fileName, ...parsed, ...(updatedAt ? { updatedAt } : {}) };
  } catch {
    return null;
  }
}

/** Rebuild MEMORY.md from the manifest, preserving any non-index lines. */
async function rebuildIndex(workspaceRoot: string): Promise<void> {
  const manifest = await listMemoryManifest(workspaceRoot);
  let preserved = '';
  try {
    const existing = await readWorkspaceText(workspaceRoot, INDEX_FILE, 50_000);
    preserved = existing.content
      .split('\n')
      .filter((line) => line.trim() && !INDEX_LINE.test(line.trim()) && line.trim() !== '# Memory')
      .join('\n')
      .trim();
  } catch {
    /* no index yet */
  }
  const lines = manifest.map(
    (m) => `- [${m.name}](${MEMORY_DIR}/${m.fileName}) — ${m.description}`,
  );
  const content = [
    '# Memory',
    '',
    ...lines,
    ...(preserved ? ['', preserved] : []),
    '',
  ].join('\n');
  await writeWorkspaceFile(workspaceRoot, INDEX_FILE, content);
}

/** Create or overwrite one memory file and refresh the index. */
export async function writeMemoryEntry(
  workspaceRoot: string,
  entry: { name: string; description: string; type: MemoryType; body: string },
): Promise<{ path: string; fileName: string }> {
  assertMemorySafe(`${entry.name}\n${entry.description}\n${entry.body}`);
  await ensureMemoryDir(workspaceRoot);
  const fileName = memoryFileNameFor(entry.name);
  const relPath = `${MEMORY_DIR}/${fileName}`;
  await writeWorkspaceFile(workspaceRoot, relPath, serializeEntry(entry));
  await rebuildIndex(workspaceRoot);
  return { path: relPath, fileName };
}

export async function deleteMemoryEntry(workspaceRoot: string, fileName: string): Promise<void> {
  if (fileName.includes('/') || fileName.includes('..')) return;
  await fs.rm(path.join(memoryDirPath(workspaceRoot), fileName), { force: true });
  await rebuildIndex(workspaceRoot);
}
