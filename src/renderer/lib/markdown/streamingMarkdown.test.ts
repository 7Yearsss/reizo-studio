import { describe, expect, it } from 'vitest';
import {
  needsWholeDocumentContext,
  splitStreamingMarkdownChunks,
} from './splitStreamingMarkdownChunks';
import { repairStreamingMarkdown } from './repairStreamingMarkdown';

describe('splitStreamingMarkdownChunks', () => {
  it('returns a single unsealed chunk for short / no-boundary text', () => {
    const chunks = splitStreamingMarkdownChunks('just a line being typed');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ start: 0, sealed: false });
  });

  it('seals paragraphs before the growing tail', () => {
    const md = 'First paragraph, done.\n\nSecond paragraph, done.\n\nThird still typ';
    const chunks = splitStreamingMarkdownChunks(md);
    expect(chunks.filter((c) => c.sealed)).toHaveLength(2);
    expect(chunks.at(-1)).toMatchObject({ sealed: false });
    expect(chunks.at(-1)!.text).toContain('Third still typ');
    // start offsets are real positions in the source
    for (const c of chunks) expect(md.slice(c.start, c.start + c.text.length)).toBe(c.text);
    // concatenating chunks reproduces the input
    expect(chunks.map((c) => c.text).join('')).toBe(md);
  });

  it('never splits inside a fenced code block', () => {
    const md = 'intro para\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\ntail typ';
    const chunks = splitStreamingMarkdownChunks(md);
    // the blank line INSIDE the fence must not be a boundary
    const sealed = chunks.filter((c) => c.sealed).map((c) => c.text).join('');
    expect(sealed.includes('```js') ? sealed.includes('```\n') : true).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(md);
  });

  it('bails to whole-document mode for reference link definitions', () => {
    const md = 'See [ref].\n\nmore text\n\n[ref]: https://example.com';
    expect(needsWholeDocumentContext(md)).toBe(true);
    expect(splitStreamingMarkdownChunks(md)).toHaveLength(1);
  });

  it('bails to whole-document mode for multiple headings', () => {
    expect(needsWholeDocumentContext('# A\n\ntext\n\n# B')).toBe(true);
    expect(splitStreamingMarkdownChunks('# A\n\ntext\n\n# B')).toHaveLength(1);
  });
});

describe('repairStreamingMarkdown', () => {
  it('closes an unterminated code fence', () => {
    expect(repairStreamingMarkdown('```js\nconst a = 1;')).toBe('```js\nconst a = 1;\n```');
  });

  it('leaves a balanced fence alone', () => {
    const md = '```js\nconst a = 1;\n```';
    expect(repairStreamingMarkdown(md)).toBe(md);
  });

  it('closes an unterminated $$ math block', () => {
    expect(repairStreamingMarkdown('text\n$$\na = b')).toBe('text\n$$\na = b\n$$');
  });

  it('skips ALL inline repair when inline backticks are odd', () => {
    // half-open inline code + a dangling ** — must NOT add **
    const md = 'here is `code and **bold';
    expect(repairStreamingMarkdown(md)).toBe(md);
  });

  it('closes a trailing ** opener that has body text', () => {
    expect(repairStreamingMarkdown('this is **important')).toBe('this is **important**');
  });

  it('does not close a lone trailing ** with no body', () => {
    expect(repairStreamingMarkdown('a list item **')).toBe('a list item **');
  });

  it('is a no-op on plain prose', () => {
    const md = 'The quick brown fox.\n\nAnother sentence here.';
    expect(repairStreamingMarkdown(md)).toBe(md);
  });
});
