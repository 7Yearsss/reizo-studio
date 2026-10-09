/** A replacement of `oldText.slice(start, end)` by `text`. Offsets are UTF-16 indices into the old text. */
export interface TextHunk { start: number; end: number; text: string }

const TOKEN = /[A-Za-z0-9_]+|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g;
const MAX_CELLS = 400_000;

function tokenize(text: string): string[] { return text.match(TOKEN) ?? []; }
const length = (tokens: string[], from: number, to: number) => { let n = 0; for (let i = from; i < to; i++) n += tokens[i].length; return n; };

/**
 * Smallest set of changed spans between two strings, at word granularity for Latin text and character
 * granularity for CJK. Nearby spans (equal gap of `mergeGap` characters or fewer) are merged so a review
 * shows one coherent change instead of confetti.
 */
export function diffHunks(oldText: string, newText: string, mergeGap = 2): TextHunk[] {
  if (oldText === newText) return [];
  const a = tokenize(oldText); const b = tokenize(newText);
  let head = 0; while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0; while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const aMid = a.slice(head, a.length - tail); const bMid = b.slice(head, b.length - tail);
  const base = length(a, 0, head);
  const spans: { aFrom: number; aTo: number; bFrom: number; bTo: number }[] = [];
  if (aMid.length * bMid.length > MAX_CELLS || !aMid.length || !bMid.length) spans.push({ aFrom: 0, aTo: aMid.length, bFrom: 0, bTo: bMid.length });
  else {
    const n = aMid.length; const m = bMid.length;
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = aMid[i] === bMid[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0; let j = 0; let open: { aFrom: number; bFrom: number } | null = null;
    const close = () => { if (open) { spans.push({ aFrom: open.aFrom, aTo: i, bFrom: open.bFrom, bTo: j }); open = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && aMid[i] === bMid[j]) { close(); i++; j++; }
      else { open ??= { aFrom: i, bFrom: j }; if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) j++; else i++; }
    }
    close();
  }
  const hunks: TextHunk[] = spans.map((s) => ({
    start: base + length(aMid, 0, s.aFrom), end: base + length(aMid, 0, s.aTo), text: bMid.slice(s.bFrom, s.bTo).join(''),
  }));
  const merged: TextHunk[] = [];
  for (const hunk of hunks) {
    const last = merged[merged.length - 1];
    if (last && hunk.start - last.end <= mergeGap) merged[merged.length - 1] = { start: last.start, end: hunk.end, text: last.text + oldText.slice(last.end, hunk.start) + hunk.text };
    else merged.push(hunk);
  }
  return merged;
}
