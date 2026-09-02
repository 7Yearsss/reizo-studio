import { describe, expect, it } from 'vitest';
import { normalizeMarkdownFences } from './normalizeMarkdownFences';

describe('normalizeMarkdownFences', () => {
  it('splits a closer that has trailing prose on the same line', () => {
    const md = [
      '提交信息可以是：',
      '',
      '```text',
      'Track turn outcomes and resume interrupted agent turns',
      '```我看了未提交文件。结论：这批改动范围比较大。',
      '',
      '**主要风险**',
    ].join('\n');

    expect(normalizeMarkdownFences(md)).toBe(
      [
        '提交信息可以是：',
        '',
        '```text',
        'Track turn outcomes and resume interrupted agent turns',
        '```',
        '我看了未提交文件。结论：这批改动范围比较大。',
        '',
        '**主要风险**',
      ].join('\n'),
    );
  });

  it('splits unlabeled fences the same way', () => {
    const md = '```\ncommit title\n```后面的段落\n\n**bold**';
    expect(normalizeMarkdownFences(md)).toBe('```\ncommit title\n```\n后面的段落\n\n**bold**');
  });

  it('leaves a legal closer with only trailing spaces alone', () => {
    const md = '```js\nconst a = 1;\n```   \n';
    expect(normalizeMarkdownFences(md)).toBe(md);
  });

  it('leaves a balanced fence with following markdown on the next line alone', () => {
    const md = '```text\ncommit\n```\n\n**风险**';
    expect(normalizeMarkdownFences(md)).toBe(md);
  });

  it('does not treat an opening info string as a glued closer', () => {
    const md = '```javascript extra\nconst a = 1;\n```';
    expect(normalizeMarkdownFences(md)).toBe(md);
  });

  it('handles tilde fences', () => {
    const md = '~~~\ncode\n~~~and then prose';
    expect(normalizeMarkdownFences(md)).toBe('~~~\ncode\n~~~\nand then prose');
  });

  it('is a no-op on plain prose', () => {
    const md = 'The quick brown fox.\n\nAnother sentence here.';
    expect(normalizeMarkdownFences(md)).toBe(md);
  });
});
