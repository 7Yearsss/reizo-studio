/**
 * The composer draft is a plain string everywhere (submit, slash/@ menus, queue, recall).
 * Inline reference chips are only how that string is *shown*: a citation `[n]` of a picked
 * range renders as a chip, and a chip serializes back to `[n]`. These helpers convert
 * between the string and the editor's JSON document.
 */

export interface DraftNode {
  type: string;
  attrs?: { label?: number };
  text?: string;
  content?: DraftNode[];
}

const CITATION = /\[(\d{1,3})\]/g;

/** Draft string → editor document. `[n]` becomes a chip when `isLabel(n)`; newlines become hard breaks. */
export function parseDraft(text: string, isLabel: (label: number) => boolean): DraftNode {
  const inline: DraftNode[] = [];
  const pushText = (chunk: string): void => {
    chunk.split('\n').forEach((line, index) => {
      if (index > 0) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
  };
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const label = Number(match[1]);
    if (!isLabel(label)) continue;
    const at = match.index ?? 0;
    pushText(text.slice(last, at));
    inline.push({ type: 'referenceChip', attrs: { label } });
    last = at + match[0].length;
  }
  pushText(text.slice(last));
  return { type: 'doc', content: [{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }] };
}

/** Editor document → draft string. Paragraphs and hard breaks are newlines; a chip is `[n]`. */
export function serializeDraft(doc: DraftNode): string {
  const blocks = (doc.content ?? []).map((block) =>
    (block.content ?? [])
      .map((node) => {
        if (node.type === 'text') return node.text ?? '';
        if (node.type === 'hardBreak') return '\n';
        if (node.type === 'referenceChip') return `[${node.attrs?.label ?? 0}]`;
        return '';
      })
      .join(''),
  );
  return blocks.join('\n');
}

/**
 * Rewrites `[n]` citations after the numbered ranges changed: `renumber(old)` gives the new
 * number, or null when that range is gone (its citation is dropped with one trailing space).
 */
export function renumberCitations(text: string, renumber: (label: number) => number | null | undefined): string {
  return text.replace(/\[(\d{1,3})\]( ?)/g, (whole, digits: string, space: string) => {
    const next = renumber(Number(digits));
    if (next === undefined) return whole;
    return next === null ? '' : `[${next}]${space}`;
  });
}
