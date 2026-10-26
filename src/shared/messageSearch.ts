/** Split a query on whitespace into at most 5 terms; every term must appear in a message. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.trim().split(/\s+/).filter(Boolean))].slice(0, 5).map((t) => t.slice(0, 64));
}

/** SQL LIKE pattern for a literal term (use with `ESCAPE '\'`). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A short window of `text` around the first matching term, with an ellipsis where it was cut. */
export function makeSnippet(text: string, terms: string[], radius = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export interface MessageHit {
  sessionId: string;
  title: string;
  messageId: string;
  role: 'user' | 'assistant';
  snippet: string;
  /** ISO time of the message. */
  at: string;
}
