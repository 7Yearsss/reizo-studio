// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import PanelErrorBoundary from './PanelErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let broken = true;
function Flaky() {
  if (broken) throw new Error('boom');
  return <p>ok</p>;
}

test('a crash stays in the panel, retry recovers, and a new key resets it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (key: string) => act(async () => { root.render(<><p>outside</p><PanelErrorBoundary resetKey={key}><Flaky /></PanelErrorBoundary></>); });

  await render('a');
  expect(host.textContent).toContain('outside');
  expect(host.querySelector('[data-ui="app.panel-error"]')?.textContent).toContain('boom');

  broken = false;
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-ui="app.panel-error"] button')!.click(); });
  expect(host.textContent).toContain('ok');

  broken = true;
  await render('b');
  expect(host.querySelector('[data-ui="app.panel-error"]')).not.toBeNull();
  broken = false;
  await render('c');
  expect(host.textContent).toContain('ok');
  await act(async () => root.unmount());
});
