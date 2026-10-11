// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InlineEditCard, { EDIT_PRESETS } from './InlineEditCard';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

function render(props: Partial<Parameters<typeof InlineEditCard>[0]> = {}) {
  const handlers = { onSubmit: vi.fn(), onCancel: vi.fn(), onStop: vi.fn() };
  act(() => { root.render(<InlineEditCard phase="input" {...handlers} {...props} />); });
  return handlers;
}
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

it('sends a typed instruction on Enter and cancels on Escape', () => {
  const handlers = render();
  const input = host.querySelector('input')!;
  type(input, '语气更正式一点');
  key(input, 'Enter');
  expect(handlers.onSubmit).toHaveBeenCalledWith('语气更正式一点');
  key(input, 'Escape');
  expect(handlers.onCancel).toHaveBeenCalled();
});

it('ignores an empty instruction and offers one-click presets that send immediately', () => {
  const handlers = render();
  key(host.querySelector('input')!, 'Enter');
  expect(handlers.onSubmit).not.toHaveBeenCalled();
  const presets = [...host.querySelectorAll('button')].filter((b) => (EDIT_PRESETS as readonly string[]).includes(b.textContent ?? ''));
  expect(presets).toHaveLength(EDIT_PRESETS.length);
  act(() => { presets[0].click(); });
  expect(handlers.onSubmit).toHaveBeenCalledWith(EDIT_PRESETS[0]);
});

it('blocks sending while the chat is busy', () => {
  const handlers = render({ blocked: true });
  const input = host.querySelector('input')!;
  expect(input.disabled).toBe(true);
  expect(host.querySelectorAll('button').length).toBe(1); // only the (disabled) send button, no presets
  expect(handlers.onSubmit).not.toHaveBeenCalled();
});

it('shows progress with a stop, and a notice that can be dismissed', () => {
  const working = render({ phase: 'working' });
  expect(host.textContent).toContain('正在改写');
  act(() => { [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('停止'))!.click(); });
  expect(working.onStop).toHaveBeenCalled();
  const notice = render({ phase: 'notice', notice: '已停止' });
  act(() => { [...host.querySelectorAll('button')].find((b) => b.textContent === '知道了')!.click(); });
  expect(notice.onCancel).toHaveBeenCalled();
});
