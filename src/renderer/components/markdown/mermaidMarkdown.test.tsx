// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { mermaidMarkdownComponents } from './mermaidMarkdown';

describe('mermaid markdown components', () => {
  it('replaces a mermaid fence and leaves other code alone', () => {
    const html = renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { components: mermaidMarkdownComponents, remarkPlugins: [remarkGfm] },
        '```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst n = 1;\n```\n',
      ),
    );
    expect(html).toContain('data-mermaid="flowchart"');
    expect(html).toContain('<svg');
    expect(html).toContain('const n = 1;');
    expect(html).not.toContain('language-mermaid');
  });
});
