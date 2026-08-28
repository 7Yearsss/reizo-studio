// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders settled markdown to HTML', () => {
    const html = renderToString(<MarkdownContent content={'# Title\n\nsome **bold** text'} />);
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders streaming markdown as sealed blocks + a repaired tail without throwing', () => {
    const md = 'First paragraph is complete.\n\nSecond paragraph is complete.\n\n```js\nconst x = 1;';
    const html = renderToString(<MarkdownContent content={md} streaming />);
    expect(html).toContain('First paragraph is complete.');
    expect(html).toContain('Second paragraph is complete.');
    // the unterminated fence was repaired -> rendered as a highlighted <pre>
    expect(html).toContain('<pre');
    expect(html).toContain('language-js');
    expect(html).toMatch(/const<\/span>\s*x/);
  });

  it('renders an empty streaming string without throwing', () => {
    expect(() => renderToString(<MarkdownContent content="" streaming />)).not.toThrow();
  });
});
