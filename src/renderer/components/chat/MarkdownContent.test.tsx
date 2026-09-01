// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders settled markdown to HTML', () => {
    const html = renderToString(<MarkdownContent content={'# Title\n\nsome **bold** text'} />);
    expect(html).toContain('<h1');
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('bold');
  });

  it('renders streaming markdown with incomplete fences without throwing', () => {
    const md = 'First paragraph is complete.\n\nSecond paragraph is complete.\n\n```js\nconst x = 1;';
    const html = renderToString(<MarkdownContent content={md} streaming />);
    expect(html).toContain('First paragraph is complete.');
    expect(html).toContain('Second paragraph is complete.');
    expect(html).toContain('const x = 1;');
  });

  it('renders an empty streaming string without throwing', () => {
    expect(() => renderToString(<MarkdownContent content="" streaming />)).not.toThrow();
  });

  it('renders markdown that was glued to a fence closer instead of swallowing it as TEXT', () => {
    const md = [
      '提交信息可以是：',
      '',
      '```text',
      'Track turn outcomes and resume interrupted agent turns',
      '```我看了未提交文件。结论：这批改动范围比较大。',
      '',
      '**主要风险**',
      '',
      '1. permissions.ts 会清掉 pending interaction',
    ].join('\n');
    const html = renderToString(<MarkdownContent content={md} />);
    expect(html).toContain('Track turn outcomes');
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('主要风险');
    expect(html).toContain('我看了未提交文件');
    const codeBody = html.match(/data-streamdown="code-block-body"[\s\S]*?<\/pre>/)?.[0] ?? '';
    expect(codeBody).toContain('Track turn outcomes');
    expect(codeBody).not.toContain('主要风险');
    expect(codeBody).not.toContain('我看了未提交文件');
  });
});
