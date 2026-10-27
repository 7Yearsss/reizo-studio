/**
 * Local knowledge search without an embedding model: split documents into passages and rank them with BM25 over
 * words (Latin) and character pairs (Chinese / Japanese / Korean, which have no spaces to split on). It needs no
 * network, no model and no API key, and it answers the common "find where I wrote about X" task honestly: it matches
 * the words you used, it does not guess at meaning.
 */
export interface Chunk { docId: string; index: number; text: string }
export interface SearchHit { docId: string; index: number; text: string; score: number }

const MAX_CHUNK = 900;
const MIN_CHUNK = 200;

/** Passages that follow paragraph boundaries, packed up to ~900 characters; an over-long paragraph is cut at sentence ends. */
export function chunkText(docId: string, text: string): Chunk[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK) { pieces.push(paragraph); continue; }
    let rest = paragraph;
    while (rest.length > MAX_CHUNK) {
      const window = rest.slice(0, MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('！'), window.lastIndexOf('？'), window.lastIndexOf('\n'));
      const at = cut > MAX_CHUNK * 0.5 ? cut + 1 : MAX_CHUNK;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: Chunk[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > MAX_CHUNK) { chunks.push({ docId, index: chunks.length, text: current }); current = piece; }
    else current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) {
    // A short tail joins the previous passage instead of standing alone.
    const last = chunks[chunks.length - 1];
    if (last && current.length < MIN_CHUNK && last.text.length + current.length + 2 <= MAX_CHUNK * 1.3) last.text = `${last.text}\n\n${current}`;
    else chunks.push({ docId, index: chunks.length, text: current });
  }
  return chunks;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** Lower-case words, plus every adjacent pair of CJK characters (and the single character when it stands alone). */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!run) continue;
    let word = '';
    let cjk: string[] = [];
    const flushCjk = (): void => {
      if (cjk.length === 1) tokens.push(cjk[0]);
      for (let i = 0; i + 1 < cjk.length; i += 1) tokens.push(cjk[i] + cjk[i + 1]);
      cjk = [];
    };
    for (const ch of run) {
      if (CJK.test(ch)) { if (word) { tokens.push(word); word = ''; } cjk.push(ch); }
      else { flushCjk(); word += ch; }
    }
    flushCjk();
    if (word) tokens.push(word);
  }
  return tokens;
}

export interface KnowledgeIndex {
  search(query: string, limit?: number): SearchHit[];
  size: number;
}

const K1 = 1.5;
const B = 0.75;

export function buildIndex(chunks: readonly Chunk[]): KnowledgeIndex {
  const docs = chunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { chunk, tf, length: tokens.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  return {
    size: docs.length,
    search(query, limit = 5) {
      const terms = [...new Set(tokenize(query))];
      if (terms.length === 0 || docs.length === 0) return [];
      const hits: SearchHit[] = [];
      for (const d of docs) {
        let score = 0;
        for (const term of terms) {
          const f = d.tf.get(term);
          if (!f) continue;
          const n = df.get(term) ?? 0;
          const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
          score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / Math.max(1, avg))));
        }
        if (score > 0) hits.push({ docId: d.chunk.docId, index: d.chunk.index, text: d.chunk.text, score });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}
