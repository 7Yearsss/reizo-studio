import { readdir, readFile } from 'node:fs/promises';
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

export async function readAllTraces(dataRoot: string): Promise<TurnTrace[]> {
  const dir = path.join(dataRoot, 'traces');
  const names = await readdir(dir).catch(() => [] as string[]);
  const traces: TurnTrace[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const text = await readFile(path.join(dir, name), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        traces.push(JSON.parse(line) as TurnTrace);
      } catch {
        // a torn trailing line must not hide the rest
      }
    }
  }
  return traces;
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

/** Auto mode: apply every pending proposal. Errors are swallowed — this runs fire-and-forget after a turn. */
export async function applyAllHarnessProposals(dataRoot: string): Promise<number> {
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
