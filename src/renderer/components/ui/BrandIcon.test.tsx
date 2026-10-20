// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandIcon, SimpleIcon } from './BrandIcon';

describe('BrandIcon component', () => {
  it('renders built-in domestic brands with authentic SVGs', () => {
    const brands = ['feishu', 'wecom', 'dingtalk', 'yuque', 'gitee'] as const;
    for (const b of brands) {
      const html = renderToString(<BrandIcon brand={b} name={b} />);
      expect(html).toContain('<svg');
    }
  });

  it('renders built-in international brands with SVGs', () => {
    const brands = ['notion', 'gmail', 'github', 'bilibili'] as const;
    for (const b of brands) {
      const html = renderToString(<BrandIcon brand={b} name={b} />);
      expect(html).toContain('<svg');
    }
  });

  it('renders simple-icons cdn img for non-builtin slug', () => {
    const html = renderToString(<BrandIcon brand="slack" name="Slack" />);
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.simpleicons.org/slack"');
  });

  it('supports bare mode without container border styles', () => {
    const html = renderToString(<BrandIcon brand="gitee" bare />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('border');
  });

  it('SimpleIcon falls back to built-in SVG when slug matches built-in', () => {
    const html = renderToString(<SimpleIcon slug="gitee" />);
    expect(html).toContain('<svg');
    expect(html).toContain('#C71D23');
  });
});
