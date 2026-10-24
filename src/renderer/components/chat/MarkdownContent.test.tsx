// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent';

describe('MarkdownContent', () => {
  it('compacts redundant file confirmations and download links only for a confirmed file card', () => {
    const file = { artifactId: 'file-1', name: '赤壁赋.txt', version: 1 };
    const content = '我来生成苏轼《赤壁赋》（前赤壁赋）的 TXT 文件。\n\n已生成 **《赤壁赋.txt》**，包含苏轼《前赤壁赋》全文，可在文件卡片中预览、下载。已生成 **赤壁赋.txt**，包含苏轼《赤壁赋》（前赤壁赋）全文。\n\n[下载赤壁赋.txt](/api/artifacts/file-1/download?v=1)已生成 **赤壁赋.txt**，包含苏轼《赤壁赋》（前赤壁赋）全文。\n\n[下载赤壁赋.txt](/api/artifacts/file-1/download?v=1)';
    const html = renderToString(<MarkdownContent content={content} generatedFiles={[file]} />);
    expect((html.match(/已生成/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('我来生成');
    expect(html).not.toContain('href="/api/artifacts/file-1/download');
    expect(html).toContain('赤壁赋.txt');
    // Without a successful tool/card, preserve the model's only download link.
    expect(renderToString(<MarkdownContent content={content} />)).toContain('href="/api/artifacts/file-1/download');
  });

  it('preserves caveats, other files, old versions, external links and code examples', () => {
    const content = '注意：此文件仅含节选，尚未校对。\n\n[旧版](/api/artifacts/file-1/download?v=0) [另一个文件](/api/artifacts/file-2/download?v=1) [官网](https://example.com/api/artifacts/file-1/download?v=1)\n\n```md\n[示例](/api/artifacts/file-1/download?v=1)\n```';
    const html = renderToString(<MarkdownContent content={content} generatedFiles={[{ artifactId: 'file-1', name: '赤壁赋.txt', version: 1 }]} />);
    expect(html).toContain('此文件仅含节选，尚未校对');
    expect(html).toContain('href="/api/artifacts/file-1/download?v=0"');
    expect(html).toContain('href="/api/artifacts/file-2/download?v=1"');
    expect(html).toContain('https://example.com/api/artifacts/file-1/download?v=1');
    expect(html).toContain('示例');
    expect(html).toContain('data-streamdown="code-block');
  });
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

  it('keeps Chinese emphasis, lists and quotes as semantic Markdown', () => {
    const html = renderToString(<MarkdownContent content={'**制作完成**，可以预览。\n\n> 代码，也能拍电影。\n\n- **镜头**：雨夜追逐\n- 音乐踩点'} />);
    expect(html).toMatch(/<strong[^>]*>制作完成<\/strong>/);
    expect(html).toContain('<blockquote');
    expect(html).toContain('<ul');
    expect(html).not.toContain('**');
  });

  it('routes Windows and inline-code file links to previews without touching code fences', () => {
    const html = renderToString(<MarkdownContent content={'[封面](<F:/作品/cover.png>) · `out/share.md`\n\n```ts\nconst file = "out/share.md";\n```'} />);
    expect(html).toContain('href="#workspace-file:F%3A%2F');
    expect(html).toContain('href="#workspace-file:out%2Fshare.md"');
    expect((html.match(/href="#workspace-file:/g) ?? []).length).toBe(2);
  });

  it('keeps external links external and removes executable links', () => {
    const html = renderToString(<MarkdownContent content={'[官网](https://example.com/demo.mp4) [危险](javascript:alert%281%29)'} />);
    expect(html).toContain('href="https://example.com/demo.mp4"');
    expect(html).not.toContain('href="javascript:');
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

describe('mermaid fences', () => {
  it('draws a finished fence as SVG', () => {
    const html = renderToString(
      <MarkdownContent content={'说明\n\n```mermaid\nflowchart LR\n  A --> B\n```\n'} />,
    );
    expect(html).toContain('data-mermaid="flowchart"');
    expect(html).toContain('<svg');
    expect(html).toContain('class="pele pele-flowchart"');
  });

  it('keeps an unfinished fence as source while it streams', () => {
    const html = renderToString(
      <MarkdownContent content={'```mermaid\nflowchart LR\n  A -->'} streaming />,
    );
    expect(html).toContain('data-mermaid="pending"');
    expect(html).toContain('A --&gt;');
    expect(html).not.toContain('class="pele');
  });
});

describe('sheet cell links in replies', () => {
  it('renders a sheet-qualified address as a link the chat can intercept', () => {
    const html = renderToString(<MarkdownContent content={'问题在 Sheet1!C5，其余没问题'} />);
    expect(html).toContain('href="#sheetcell:Sheet1!C5"');
    expect(html).toContain('Sheet1!C5</a>');
  });
});
