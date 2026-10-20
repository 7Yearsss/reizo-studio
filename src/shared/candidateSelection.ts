/**
 * Harness² C1–C3: Anonymous Best-of-N candidate selection.
 * - Pre-filters empty/failed candidates before invoking a selector or presenting direction cards.
 * - Assigns seeded anonymous IDs (`cand_a`, `cand_b`, ...) in shuffled order so model/strategy
 *   labels and array positions cannot bias selection.
 * - Parses structured JSON selection (`{"selected_candidate_id": "cand_x", "reasoning": "..."}`)
 *   and maps back to the original candidate.
 */

export interface CandidateItem<T = unknown> {
  id: string;
  label?: string;
  summary: string;
  deliverables?: string[];
  ok?: boolean;
  payload?: T;
}

export interface AnonymousCandidate<T = unknown> {
  anonId: string;
  original: CandidateItem<T>;
}

/** Deterministic PRNG (Mulberry32) from an integer or string seed. */
function seededRandom(seed: number | string): () => number {
  let h = typeof seed === 'number' ? seed | 0 : 2166136261;
  if (typeof seed === 'string') {
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    }
  }
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Harness² C2: Filter out candidates that errored or produced neither summary text nor deliverables.
 */
export function filterValidCandidates<T>(candidates: CandidateItem<T>[]): CandidateItem<T>[] {
  return candidates.filter((c) => {
    if (c.ok === false) return false;
    const hasText = Boolean(c.summary && c.summary.trim().length > 0);
    const hasFiles = Boolean(c.deliverables && c.deliverables.length > 0);
    return hasText || hasFiles;
  });
}

/**
 * Harness² C1: Shuffle valid candidates with a deterministic seed and assign anonymous IDs (`cand_a`, `cand_b`, ...).
 */
export function assignAnonymousIds<T>(
  candidates: CandidateItem<T>[],
  seed: number | string = 42,
): AnonymousCandidate<T>[] {
  const valid = filterValidCandidates(candidates);
  const copy = [...valid];
  const rand = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.map((original, idx) => ({
    anonId: `cand_${String.fromCharCode(97 + (idx % 26))}${idx >= 26 ? Math.floor(idx / 26) : ''}`,
    original,
  }));
}

export function buildSelectionPrompt<T>(task: string, anonCandidates: AnonymousCandidate<T>[]): string {
  const blocks = anonCandidates.map((c) => {
    const files = c.original.deliverables?.length ? `\nDeliverables: ${c.original.deliverables.join(', ')}` : '';
    return `### ${c.anonId}\n${c.original.summary.trim()}${files}`;
  });
  return [
    'You are an impartial judge selecting the best candidate output for the user request.',
    'Evaluate strictly on: (1) task completeness & deliverable conformance, (2) factual accuracy & internal consistency, (3) clarity and polish.',
    'Candidates are anonymized (`cand_a`, `cand_b`, ...). Reply with ONLY a JSON object:',
    '{"selected_candidate_id": "cand_a", "reasoning": "one concise paragraph"}',
    '',
    `Task:\n${task.trim()}`,
    '',
    'Candidates:',
    blocks.join('\n\n'),
  ].join('\n');
}

export function parseSelectionReply<T>(
  replyText: string,
  anonCandidates: AnonymousCandidate<T>[],
): { winner: CandidateItem<T>; anonId: string; reasoning: string } | null {
  if (!anonCandidates.length) return null;
  const match = replyText.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { selected_candidate_id?: string; reasoning?: string };
      const hit = anonCandidates.find((c) => c.anonId === parsed.selected_candidate_id);
      if (hit) {
        return {
          winner: hit.original,
          anonId: hit.anonId,
          reasoning: parsed.reasoning ?? '',
        };
      }
    } catch {
      /* fall through to regex fallback */
    }
  }
  const tokenHit = anonCandidates.find((c) => new RegExp(`\\b${c.anonId}\\b`).test(replyText));
  if (tokenHit) {
    return { winner: tokenHit.original, anonId: tokenHit.anonId, reasoning: replyText.trim().slice(0, 300) };
  }
  return { winner: anonCandidates[0].original, anonId: anonCandidates[0].anonId, reasoning: 'fallback to first valid candidate' };
}
