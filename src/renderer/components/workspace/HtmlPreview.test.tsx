// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import HtmlPreview, { htmlPreviewSource } from './HtmlPreview';
it('keeps executable previews opaque and places network/form restrictions before authored markup', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const html = '<h1>Page</h1><script>parent.document.body.innerHTML="bad"</script>';
  try {
    await act(async () => root.render(<HtmlPreview html={html} />));
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    await act(async () => root.render(<HtmlPreview html={html} run />));
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    const source = htmlPreviewSource(html, true);
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('<h1>'));
    expect(source).toContain("connect-src 'none'"); expect(source).toContain("form-action 'none'");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
