export interface MentionCandidate {
  id: string;
  label: string;
  assets: string[];
}

export interface ResolveMentionsResult {
  resolvedPrompt: string;
  orderedAssetRefs: string[];
}

/**
 * Canonical inline-mention syntax stored inside a node's `prompt` string:
 *   @[女主特写](canvas:node_abc123)
 * The id is authoritative; the label is a human-readable cache that the editor
 * refreshes from the live node title on every render.
 */
export const CANONICAL_MENTION_RE = /@\[([^\]]*)\]\(canvas:([A-Za-z0-9_-]+)\)/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function serializeMention(label: string, id: string): string {
  // Strip brackets/parens from the label so the token stays parseable.
  const safe = label.replace(/[[\]()]/g, '').trim() || id.slice(0, 6);
  return `@[${safe}](canvas:${id})`;
}

export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; id: string; label: string };

/** Split a stored prompt into plain-text runs and canonical mention tokens. */
export function parseMentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let last = 0;
  const re = new RegExp(CANONICAL_MENTION_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    tokens.push({ type: 'mention', label: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/**
 * Parses @node mentions in a prompt, replaces them with model placeholder tokens
 * (<<<image 1>>>, <<<image 2>>>, ...), and reorders the referenced image assets
 * so that orderedAssetRefs[N-1] corresponds exactly to <<<image N>>>.
 *
 * Matching priority:
 *  0. Canonical `@[label](canvas:<id>)` — exact, id-anchored (from the chip editor)
 *  1. Bare candidate label (longest-first, case-insensitive) — agent/legacy prompts
 *  2. Node ID prefix `@#<id[:8]>` or `@<id>` — agent/legacy prompts
 *
 * Unmatched bare @mentions are left as plain text. A canonical mention whose node
 * has no asset (or no longer exists) degrades to its bare label.
 */
export function resolveMentions(
  prompt: string,
  candidates: MentionCandidate[],
): ResolveMentionsResult {
  if (!prompt || !prompt.includes('@') || candidates.length === 0) {
    return { resolvedPrompt: prompt, orderedAssetRefs: [] };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));

  type Span = {
    start: number;
    end: number;
    candidate: MentionCandidate | null;
    /** Text to emit when the candidate has no usable asset. */
    fallbackText: string;
  };

  const spans: Span[] = [];
  const claimed = new Set<number>();

  const claim = (start: number, end: number): boolean => {
    for (let i = start; i < end; i++) if (claimed.has(i)) return false;
    for (let i = start; i < end; i++) claimed.add(i);
    return true;
  };

  // Pass 0: canonical @[label](canvas:id)
  {
    const re = new RegExp(CANONICAL_MENTION_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const end = m.index + m[0].length;
      if (!claim(m.index, end)) continue;
      const candidate = byId.get(m[2]) ?? null;
      spans.push({ start: m.index, end, candidate, fallbackText: m[1] });
    }
  }

  // Pass 1: bare label (longest-first to avoid partial prefix collisions)
  const sortedByLabel = [...candidates]
    .filter((c) => c.label && c.label.trim().length > 0)
    .sort((a, b) => b.label.length - a.label.length);
  for (const candidate of sortedByLabel) {
    const escaped = escapeRegExp(candidate.label);
    const regex = new RegExp(`@${escaped}`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(prompt)) !== null) {
      const end = m.index + m[0].length;
      if (!claim(m.index, end)) continue;
      spans.push({ start: m.index, end, candidate, fallbackText: prompt.slice(m.index, end) });
    }
  }

  // Pass 2: id prefix `@#<id[:8]>` / `@<id[:8]>`
  for (const candidate of candidates) {
    const idPrefix = escapeRegExp(candidate.id.slice(0, 8));
    const idRegex = new RegExp(`@(#)?${idPrefix}`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(prompt)) !== null) {
      const end = m.index + m[0].length;
      if (!claim(m.index, end)) continue;
      spans.push({ start: m.index, end, candidate, fallbackText: prompt.slice(m.index, end) });
    }
  }

  if (spans.length === 0) {
    return { resolvedPrompt: prompt, orderedAssetRefs: [] };
  }

  spans.sort((a, b) => a.start - b.start);

  const orderedAssetRefs: string[] = [];
  let resolvedPrompt = '';
  let lastEnd = 0;
  let imageNum = 1;

  for (const span of spans) {
    resolvedPrompt += prompt.slice(lastEnd, span.start);
    const asset = span.candidate?.assets?.[0];
    if (asset) {
      resolvedPrompt += `<<<image ${imageNum}>>>`;
      orderedAssetRefs.push(asset);
      imageNum++;
    } else {
      resolvedPrompt += span.fallbackText;
    }
    lastEnd = span.end;
  }
  resolvedPrompt += prompt.slice(lastEnd);

  return { resolvedPrompt, orderedAssetRefs };
}
