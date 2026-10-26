import { describe, expect, it } from 'vitest';
import { inlineAttachment, pageAttachment } from './attachmentText';

describe('inlineAttachment', () => {
  it('passes short content through untouched', () => {
    expect(inlineAttachment('a.txt', 'hello')).toBe('hello');
  });
  it('announces a cut and names the call that reads the rest', () => {
    const out = inlineAttachment('报表.csv', 'x'.repeat(30), 10);
    expect(out.startsWith('x'.repeat(10))).toBe(true);
    expect(out).toContain('显示 10 / 共 30');
    expect(out).toContain('read_attachment(name="报表.csv", offset=10)');
  });
});

describe('pageAttachment', () => {
  const text = 'abcdefghij';
  it('walks the whole text page by page', () => {
    const a = pageAttachment(text, 0, 4);
    expect([a.text, a.nextOffset]).toEqual(['abcd', 4]);
    const b = pageAttachment(text, a.nextOffset ?? 0, 4);
    const c = pageAttachment(text, b.nextOffset ?? 0, 4);
    expect([b.text, c.text, c.nextOffset]).toEqual(['efgh', 'ij', null]);
  });
  it('clamps bad offsets and sizes', () => {
    expect(pageAttachment(text, -5, 3).text).toBe('abc');
    expect(pageAttachment(text, 99, 3)).toMatchObject({ text: '', nextOffset: null, total: 10 });
    expect(pageAttachment(text, 2.9, 0).text).toBe('c');
    expect(pageAttachment('x'.repeat(100_000), 0, 1_000_000).text).toHaveLength(40_000);
  });
});
