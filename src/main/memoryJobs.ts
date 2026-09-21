import { generateText, type LanguageModel } from 'ai';
import type { MemoryItem } from '../shared/stream';
import {
  deleteMemoryEntry,
  listMemoryManifest,
  normalizeMemoryType,
  readMemoryEntry,
  writeMemoryEntry,
  type MemoryEntry,
} from './workspaceMemoryDir';

/**
 * zcode-style memory jobs: post-turn extraction and pre-turn semantic recall.
 * Both are best-effort — failures are logged, never surfaced to the user.
 */

const EXTRACT_MAX_NEW = 3;
const RECALL_TOP_K = 5;
const RECALL_TIMEOUT_MS = 10_000;

const pendingJobs = new Set<Promise<void>>();

function track(job: Promise<void>): void {
  pendingJobs.add(job);
  job.finally(() => pendingJobs.delete(job));
}

/** Wait for all in-flight memory jobs (call before app shutdown). */
export async function drainMemoryJobs(): Promise<void> {
  await Promise.allSettled([...pendingJobs]);
}

const EXTRACT_SYSTEM = `You maintain a memory store for an AI agent. Given one conversation turn, extract durable facts worth remembering across sessions.

Rules:
- Only save: lasting user preferences, corrections/feedback the user gave, non-obvious project facts, external references.
- Never save: anything derivable from the workspace itself (code structure, file contents, git history), one-off task details, things already covered by an existing memory.
- Keep each memory self-contained and under 120 words.
- For "feedback" memories, include why the user wants it and how to apply it.

Reply with ONLY a JSON object: {"memories": [{"name": "kebab-case-title", "description": "one line", "type": "user|feedback|project|reference", "body": "..."}], "deletions": ["existing-file-name.md"]}
Use "deletions" for existing memories this turn proved wrong or obsolete. Empty arrays are fine — most turns produce nothing.`;

export function scheduleMemoryExtraction(opts: {
  workspaceRoot: string;
  model: LanguageModel;
  userText: string;
  assistantText: string;
  onChanged?: (wrote: MemoryItem[], deleted: MemoryItem[]) => void;
}): void {
  const { workspaceRoot, model, userText, assistantText, onChanged } = opts;
  if (!userText.trim() && !assistantText.trim()) return;
  track(
    (async () => {
      try {
        const manifest = await listMemoryManifest(workspaceRoot);
        const existing = manifest.length
          ? manifest.map((m) => `- ${m.fileName}: ${m.name} (${m.type}) — ${m.description}`).join('\n')
          : '(none)';
        const result = await generateText({
          model,
          system: EXTRACT_SYSTEM,
          prompt:
            `Existing memories:\n${existing}\n\n` +
            `Turn:\nUser: ${userText.slice(0, 2000)}\n` +
            `Assistant: ${assistantText.slice(0, 3000)}`,
          maxOutputTokens: 1200,
        });
        const parsed = parseExtraction(result.text);
        if (!parsed) return;
        const deleted: MemoryItem[] = [];
        for (const file of parsed.deletions.slice(0, 5)) {
          const existing = await readMemoryEntry(workspaceRoot, file).catch((): null => null);
          await deleteMemoryEntry(workspaceRoot, file).catch((): void => undefined);
          if (existing) {
            deleted.push({
              file: existing.fileName,
              name: existing.name,
              description: existing.description,
              type: existing.type,
            });
          }
        }
        const wrote: MemoryItem[] = [];
        for (const mem of parsed.memories.slice(0, EXTRACT_MAX_NEW)) {
          if (!mem.name || !mem.body) continue;
          const saved = await writeMemoryEntry(workspaceRoot, {
            name: mem.name,
            description: mem.description || mem.name,
            type: normalizeMemoryType(mem.type),
            body: `${mem.body}\n\n_Updated ${new Date().toISOString().slice(0, 10)}_`,
          });
          wrote.push({
            file: saved.fileName,
            name: mem.name,
            description: mem.description || mem.name,
            type: normalizeMemoryType(mem.type),
          });
        }
        if (wrote.length > 0 || deleted.length > 0) {
          try {
            onChanged?.(wrote, deleted);
          } catch {
            /* notification best-effort */
          }
        }
      } catch (err) {
        console.warn(`[memory] extraction failed: ${(err as Error).message}`);
      }
    })(),
  );
}

interface Extracted {
  memories: Array<{ name?: string; description?: string; type?: string; body?: string }>;
  deletions: string[];
}

function parseExtraction(text: string): Extracted | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Extracted>;
    return {
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      deletions: Array.isArray(parsed.deletions) ? parsed.deletions.filter((d) => typeof d === 'string') : [],
    };
  } catch {
    return null;
  }
}

const SELECT_SYSTEM = `You pick which stored memories are relevant to the user's request. You are given memory entries as "fileName — description". Reply with ONLY a JSON array of the most relevant file names, at most ${RECALL_TOP_K}, most relevant first. Pick none if nothing applies: [].`;

/** Memories already injected for a session — each is recalled at most once. */
const recalledBySession = new Map<string, Set<string>>();

export function startMemoryRecall(opts: {
  sessionId: string;
  workspaceRoot: string;
  model: LanguageModel;
  query: string;
}): Promise<MemoryEntry[]> {
  const { sessionId, workspaceRoot, model, query } = opts;
  return (async () => {
    try {
      const manifest = await listMemoryManifest(workspaceRoot);
      const seen = recalledBySession.get(sessionId) ?? new Set<string>();
      recalledBySession.set(sessionId, seen);
      const candidates = manifest.filter((m) => !seen.has(m.fileName));
      if (!candidates.length || !query.trim()) return [];
      const result = await generateText({
        model,
        system: SELECT_SYSTEM,
        prompt:
          `Memories:\n${candidates.map((m) => `${m.fileName} — ${m.description}`).join('\n')}\n\n` +
          `Request: ${query.slice(0, 1500)}`,
        maxOutputTokens: 200,
      });
      const picked = parseFileList(result.text)
        .filter((f) => candidates.some((m) => m.fileName === f))
        .slice(0, RECALL_TOP_K);
      const entries: MemoryEntry[] = [];
      for (const file of picked) {
        const entry = await readMemoryEntry(workspaceRoot, file);
        if (entry) {
          seen.add(file);
          entries.push(entry);
        }
      }
      return entries;
    } catch (err) {
      console.warn(`[memory] recall failed: ${(err as Error).message}`);
      return [];
    }
  })();
}

function parseFileList(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

export function formatRecalledMemories(entries: MemoryEntry[]): string {
  const blocks = entries.map(
    (e) => `<memory name="${e.name}" type="${e.type}">\n${e.body}\n</memory>`,
  );
  return `<relevant_memory>\nThe following saved memories may be relevant. Apply them naturally; do not mention that they were recalled.\n${blocks.join('\n')}\n</relevant_memory>`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export const RECALL_BUDGET = { timeoutMs: RECALL_TIMEOUT_MS };
