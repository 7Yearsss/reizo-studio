// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMonotonicMinHeight } from './use-monotonic-min-height';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let trigger: () => void = () => undefined;
let height = 0;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { trigger = cb; } observe(): void { /* test double */ } disconnect(): void { /* test double */ } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });
});
afterEach(() => { vi.unstubAllGlobals(); });

function Probe({ active }: { active: boolean }) {
  const ref = useMonotonicMinHeight<HTMLDivElement>(active);
  return <div ref={ref} data-testid="steps" />;
}

it('holds the tallest height while active, lets go on a click, and releases when the work ends', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Probe active />));
  const el = host.querySelector<HTMLElement>('[data-testid="steps"]')!;

  height = 120; await act(async () => trigger());
  expect(el.style.minHeight).toBe('120px');
  height = 60; await act(async () => trigger());
  expect(el.style.minHeight).toBe('120px');
  height = 200; await act(async () => trigger());
  expect(el.style.minHeight).toBe('200px');

  await act(async () => { el.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
  expect(el.style.minHeight).toBe('');

  height = 90; await act(async () => trigger());
  expect(el.style.minHeight).toBe('90px');
  await act(async () => root.render(<Probe active={false} />));
  expect(el.style.minHeight).toBe('');
  await act(async () => root.unmount());
  host.remove();
});
