import { elements, escapeXml, type XmlNode } from './xml';

/** Word tracked-change helpers: a readable text diff and the OOXML plumbing around deleted source paragraphs. */

export interface DiffOp { op: 'eq' | 'ins' | 'del'; text: string }

// Latin words and whitespace runs stay whole; every CJK character and each punctuation mark is its own token.
const TOKEN = /[A-Za-z0-9_]+|\s+|[㐀-䶿一-鿿]|[^\sA-Za-z0-9_㐀-䶿一-鿿]/gu;
const MAX_LCS_CELLS = 4_000_000;
/** An unchanged stretch this short between two changes reads better folded into them. */
const FOLD_EQUAL_CHARS = 1;

function pushOp(ops: DiffOp[], op: DiffOp['op'], text: string): void {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
}

/** Token-level diff of two paragraph texts, as the minimal edits Word would show as a revision. */
export function diffText(before: string, after: string): DiffOp[] {
  if (before === after) return before ? [{ op: 'eq', text: before }] : [];
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);

  const raw: DiffOp[] = [];
  pushOp(raw, 'eq', a.slice(0, start).join(''));
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    pushOp(raw, 'del', midA.join(''));
    pushOp(raw, 'ins', midB.join(''));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) { pushOp(raw, 'eq', midA[i]); i++; j++; }
      else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) { pushOp(raw, 'ins', midB[j]); j++; }
      else { pushOp(raw, 'del', midA[i]); i++; }
    }
  }
  pushOp(raw, 'eq', a.slice(a.length - end).join(''));

  // Fold a one-character island of "unchanged" text between two changes into the changes.
  const folded: DiffOp[] = [];
  for (let k = 0; k < raw.length; k++) {
    const op = raw[k];
    const between = op.op === 'eq' && k > 0 && k < raw.length - 1 && raw[k - 1].op !== 'eq' && raw[k + 1].op !== 'eq' && [...op.text].length <= FOLD_EQUAL_CHARS;
    if (between) { pushOp(folded, 'del', op.text); pushOp(folded, 'ins', op.text); } else pushOp(folded, op.op, op.text);
  }
  // Within a changed region keep deletions before insertions, the way Word renders a replacement.
  const ordered: DiffOp[] = [];
  for (let k = 0; k < folded.length; ) {
    if (folded[k].op === 'eq') { ordered.push(folded[k++]); continue; }
    let del = '';
    let ins = '';
    while (k < folded.length && folded[k].op !== 'eq') { if (folded[k].op === 'del') del += folded[k].text; else ins += folded[k].text; k++; }
    pushOp(ordered, 'del', del);
    pushOp(ordered, 'ins', ins);
  }
  return ordered;
}

export interface OriginalParagraph { text: string; xml: string; /** The first run's `<w:rPr>`, reused for deleted text. */ rPr: string }

function paragraphText(node: XmlNode): string {
  let out = '';
  const walk = (n: XmlNode): void => {
    if (n.name === 'w:t') { out += n.children.map((c) => c.text ?? '').join(''); return; }
    if (n.name === 'w:tab') { out += '\t'; return; }
    if (n.name === 'w:br' || n.name === 'w:cr') { out += '\n'; return; }
    if (n.name === 'w:delText' || n.name === 'w:instrText' || n.name === 'w:del') return;
    for (const c of elements(n)) walk(c);
  };
  walk(node);
  return out;
}

/** The paragraphs of some original body elements in document order (nested text-box paragraphs are not separate ones). */
export function originalParagraphs(xml: string, nodes: XmlNode[]): OriginalParagraph[] {
  const out: OriginalParagraph[] = [];
  const walk = (n: XmlNode): void => {
    if (n.name === 'w:p') {
      const run = elements(n).flatMap(function find(c): XmlNode[] { return c.name === 'w:r' ? [c] : c.name === 'w:hyperlink' ? elements(c).flatMap(find) : []; })[0];
      const rPr = run ? elements(run).find((c) => c.name === 'w:rPr') : undefined;
      out.push({ text: paragraphText(n), xml: xml.slice(n.start, n.end), rPr: rPr ? xml.slice(rPr.start, rPr.end) : '' });
      return;
    }
    for (const c of elements(n)) walk(c);
  };
  for (const node of nodes) walk(node);
  return out;
}

export interface RevisionStamp { author: string; date: string; next(): number }
export const revisionAttrs = (stamp: RevisionStamp): string => `w:id="${stamp.next()}" w:author="${escapeXml(stamp.author)}" w:date="${stamp.date}"`;

/** Wraps every run of generated or original paragraph XML in `<w:ins>`. */
export function insertRuns(xml: string, stamp: RevisionStamp): string {
  return xml.replace(/<w:r>[\s\S]*?<\/w:r>/g, (run) => `<w:ins ${revisionAttrs(stamp)}>${run}</w:ins>`);
}

/** The paragraph mark's revision, so Word treats the whole paragraph as inserted / deleted. */
export function markParagraph(paragraphXml: string, kind: 'ins' | 'del', stamp: RevisionStamp): string {
  const mark = `<w:${kind} ${revisionAttrs(stamp)}/>`;
  if (/<w:pPr>/.test(paragraphXml)) {
    if (/<w:pPr>[\s\S]*?<w:rPr>/.test(paragraphXml.slice(0, paragraphXml.indexOf('</w:pPr>') + 8))) return paragraphXml.replace('<w:rPr>', `<w:rPr>${mark}`);
    return paragraphXml.replace('</w:pPr>', `<w:rPr>${mark}</w:rPr></w:pPr>`);
  }
  return paragraphXml.replace(/^<w:p(\s[^>]*)?>/, (open) => `${open}<w:pPr><w:rPr>${mark}</w:rPr></w:pPr>`);
}

/** An original paragraph (or every paragraph inside original blocks such as a table) shown as deleted. */
export function deleteParagraphs(xml: string, stamp: RevisionStamp): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paragraph) => {
    const wrapped = paragraph
      .replace(/<w:t(\s[^>]*)?>/g, (_m, attrs: string | undefined) => `<w:delText${attrs ?? ''}>`)
      .replace(/<\/w:t>/g, '</w:delText>')
      .replace(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g, (run) => `<w:del ${revisionAttrs(stamp)}>${run}</w:del>`);
    return markParagraph(wrapped, 'del', stamp);
  });
}
