// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CatalogIcon } from './CatalogIcon';

describe('CatalogIcon', () => {
  it('renders letter tile when letterOnly is set', () => {
    const html = renderToString(<CatalogIcon name="github" letterOnly />);
    expect(html).toContain('G');
    expect(html).not.toContain('<img');
  });

  it('renders letter tile when icons list is empty', () => {
    const html = renderToString(<CatalogIcon name="My Plugin" icons={[]} />);
    expect(html).toContain('M');
    expect(html).not.toContain('<img');
  });

  it('renders image element with fallback letter tile behind it when icons provided', () => {
    const html = renderToString(
      <CatalogIcon name="Awesome Server" icons={['https://example.com/logo.png']} />,
    );
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('A');
  });

  it('handles punctuation prefixes cleanly in the fallback letter', () => {
    const html = renderToString(<CatalogIcon name="@org/pkg" letterOnly />);
    expect(html).toContain('O');
  });
});
