import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadActiveHarnessRules, saveHarnessRulesOverride } from './harnessRules';
import { proposeInvariantLessonsFromTraces, type HarnessProposal } from './harnessProposer';
import type { TurnTrace } from './turnTrace';

/**
 * Closes the Harness² loop: per-turn traces (`<dataRoot>/traces/*.jsonl`) → recurring-failure
 * proposals → user-confirmed lesson appended to the hot-reloaded `harness/systemprompt.md`.
 * Proposals are always recomputed server-side from disk, so a client can only pick an id,
 * never inject prompt text.
 */

/** Only the newest files / lines are scanned so cost stays flat as history grows. */
const MAX_TRACE_FILES = 30;
const TAIL_BYTES = 64 * 1024;
const MAX_TRACES = 500;

async function readTail(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    // A tail cut can land mid-line; drop the partial first line.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}

export async function readAllTraces(dataRoot: string): Promise<TurnTrace[]> {
  const dir = path.join(dataRoot, 'traces');
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.jsonl'));
  const dated = await Promise.all(
    names.map(async (name): Promise<{ name: string; mtime: number }> => {
      try {
        return { name, mtime: (await stat(path.join(dir, name))).mtimeMs };
      } catch {
        return { name, mtime: 0 };
      }
    }),
  );
  const newest = dated.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_TRACE_FILES);
  const traces: TurnTrace[] = [];
  for (const { name } of newest) {
    const text = await readTail(path.join(dir, name)).catch(() => '');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        traces.push(JSON.parse(line) as TurnTrace);
      } catch {
        // a torn line must not hide the rest
      }
    }
    if (traces.length >= MAX_TRACES) break;
  }
  return traces.slice(0, MAX_TRACES);
}

/** Hard cap so auto-apply cannot grow the prompt without bound (mirrors Harness² ComponentSpec cap_chars). */
export const MAX_LESSONS_CHARS = 8_000;

const marker = (id: string) => `<!-- harness-lesson:${id} -->`;

export interface PendingHarnessProposal extends HarnessProposal {
  applied: boolean;
}

export async function listHarnessProposals(dataRoot: string): Promise<PendingHarnessProposal[]> {
  const [traces, rules] = await Promise.all([readAllTraces(dataRoot), loadActiveHarnessRules(dataRoot)]);
  return proposeInvariantLessonsFromTraces(traces).map((proposal) => ({
    ...proposal,
    applied: rules.systemPromptAddon.includes(marker(proposal.id)),
  }));
}

/** Returns false when the id no longer matches a current proposal; idempotent when already applied. */
export async function applyHarnessProposal(dataRoot: string, id: string): Promise<boolean> {
  const proposal = (await listHarnessProposals(dataRoot)).find((item) => item.id === id);
  if (!proposal) return false;
  if (proposal.applied) return true;
  const { systemPromptAddon } = await loadActiveHarnessRules(dataRoot);
  const block = `${marker(proposal.id)}\n### ${proposal.title}\n${proposal.content}`;
  const next = systemPromptAddon ? `${systemPromptAddon.trimEnd()}\n\n${block}` : `## Learned lessons\n\n${block}`;
  if (next.length > MAX_LESSONS_CHARS) throw new Error('harness lessons are full; remove one from harness/systemprompt.md first');
  await saveHarnessRulesOverride(dataRoot, { systemPromptAddon: next });
  return true;
}

/** Auto mode: apply every pending proposal, at most once per interval. Errors are swallowed — this runs fire-and-forget after a turn. */
const AUTO_APPLY_MIN_INTERVAL_MS = 10 * 60 * 1000;
const lastAutoApply = new Map<string, number>();

export async function applyAllHarnessProposals(dataRoot: string, minIntervalMs = AUTO_APPLY_MIN_INTERVAL_MS): Promise<number> {
  const now = Date.now();
  if (now - (lastAutoApply.get(dataRoot) ?? 0) < minIntervalMs) return 0;
  lastAutoApply.set(dataRoot, now);
  let applied = 0;
  try {
    for (const proposal of await listHarnessProposals(dataRoot)) {
      if (proposal.applied) continue;
      if (await applyHarnessProposal(dataRoot, proposal.id)) applied += 1;
    }
  } catch (error) {
    console.warn(`[harness] auto-apply failed: ${(error as Error).message}`);
  }
  return applied;
}
