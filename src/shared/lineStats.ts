export interface LineStats { added: number; removed: number }

const LCS_CELL_LIMIT = 4_000_000;

function lines(text: string): string[] {
  if (text === '') return [];
  const split = text.replace(/\r\n?/g, '\n').split('\n');
  if (split[split.length - 1] === '') split.pop();
  return split;
}

/**
 * Lines added / removed between two texts (what `git diff --numstat` would report, modulo diff-algorithm ties).
 * Common head and tail are trimmed first; very large middles fall back to a count of the differing span.
 */
export function lineStats(before: string, after: string): LineStats {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length === 0 || y.length === 0 || x.length * y.length > LCS_CELL_LIMIT) return { added: y.length, removed: x.length };

  // Longest common subsequence length over the differing middle.
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}
