// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { describe, expect, it } from 'vitest';

const math = createMathPlugin({ singleDollarTextMath: true });

describe('math in chat markdown', () => {
  it('renders block and inline formulas with KaTeX', () => {
    const html = renderToStaticMarkup(
      createElement(Streamdown, { plugins: { math }, mode: 'static' }, '$$E=mc^2$$\n\n行内 $a^2+b^2=c^2$ 公式'),
    );
    expect(html).toContain('katex');
  });
});
