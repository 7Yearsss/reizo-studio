import Pinyin from 'tiny-pinyin';

/** Full pinyin and initials for CJK text, or null when the text has no pinyin-capable character. Memoised. */
const cache = new Map<string, { full: string; initials: string } | null>();
const CACHE_LIMIT = 512;

function pinyinOf(text: string): { full: string; initials: string } | null {
  if (cache.has(text)) return cache.get(text)!;
  let result: { full: string; initials: string } | null = null;
  if (Pinyin.isSupported() && /[㐀-鿿]/.test(text)) {
    const tokens = Pinyin.parse(text);
    let full = '';
    let initials = '';
    for (const t of tokens) {
      const piece = t.type === 2 ? t.target.toLowerCase() : t.source.toLowerCase();
      full += piece;
      initials += piece.charAt(0);
    }
    result = { full, initials };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(text, result);
  return result;
}

/**
 * Score how well `query` matches `text`; 0 means no match. Substring beats full
 * pinyin beats initials, and earlier/prefix hits beat later ones.
 */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at === 0) return 100;
  if (at > 0) return 80;
  const py = pinyinOf(text);
  if (!py) return 0;
  if (py.full.startsWith(q)) return 60;
  if (py.initials.startsWith(q)) return 55;
  if (py.full.includes(q)) return 40;
  if (py.initials.includes(q)) return 35;
  return 0;
}

export function matchText(query: string, text: string): boolean {
  return matchScore(query, text) > 0;
}

/** Best score across several fields (name, description, id…). */
export function matchAny(query: string, fields: Array<string | undefined>): number {
  let best = 0;
  for (const f of fields) if (f) best = Math.max(best, matchScore(query, f));
  return best;
}
