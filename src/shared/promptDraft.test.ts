import { describe, expect, it } from 'vitest';
import { parseDraft, renumberCitations, serializeDraft } from './promptDraft';

const known = (label: number) => label === 1 || label === 2;

describe('promptDraft', () => {
  it('turns known citations into chips and round-trips to the same string', () => {
    const text = '把[1]改得更正式，[2]不变，[9]不是引用\n第二行';
    const doc = parseDraft(text, known);
    const kinds = doc.content![0].content!.map((n) => n.type);
    expect(kinds).toEqual(['text', 'referenceChip', 'text', 'referenceChip', 'text', 'hardBreak', 'text']);
    expect(doc.content![0].content![1].attrs).toEqual({ label: 1 });
    expect(serializeDraft(doc)).toBe(text);
  });

  it('handles empty drafts, leading chips and trailing newlines', () => {
    expect(serializeDraft(parseDraft('', known))).toBe('');
    expect(parseDraft('', known).content).toEqual([{ type: 'paragraph' }]);
    expect(serializeDraft(parseDraft('[1] ', known))).toBe('[1] ');
    expect(serializeDraft(parseDraft('a\n', known))).toBe('a\n');
  });

  it('joins pasted multi-paragraph documents with newlines', () => {
    expect(serializeDraft({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph', content: [{ type: 'referenceChip', attrs: { label: 2 } }] },
    ] })).toBe('a\n[2]');
  });
});

describe('renumberCitations', () => {
  it('drops removed ranges and shifts the ones after them', () => {
    const map = (n: number) => (n === 1 ? null : n === 2 ? 1 : undefined);
    expect(renumberCitations('把[1] 改正式，[2]不变，[7]保持', map)).toBe('把改正式，[1]不变，[7]保持');
  });
});
