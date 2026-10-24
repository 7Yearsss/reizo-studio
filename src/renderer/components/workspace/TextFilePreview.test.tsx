import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import TextFilePreview from './TextFilePreview';

it('shows TXT literally, preserving line breaks and escaping HTML rather than interpreting markup', () => {
  const html = renderToStaticMarkup(<TextFilePreview content={'# 原样保存\n\n**不是粗体语法**\n<script>alert(1)</script>'} />);
  expect(html).toContain('# 原样保存\n\n**不是粗体语法**');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<strong>');
  expect(html).not.toContain('<script>');
});
