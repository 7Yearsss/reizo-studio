// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import FilePreview from './FilePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ''; });

it('Esc leaves element-picking first and is swallowed so an enclosing dialog stays open', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<FilePreview path="page.html" content="<p>hi</p>" />); });
  const toggle = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('批注'));
  expect(toggle).toBeTruthy();
  act(() => { toggle?.click(); });
  expect(toggle?.getAttribute('aria-pressed')).toBe('true');

  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  expect(outer).not.toHaveBeenCalled();

  // Second Esc is no longer ours — it reaches the surrounding dialog.
  act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(outer).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', outer);
  act(() => root.unmount());
});
