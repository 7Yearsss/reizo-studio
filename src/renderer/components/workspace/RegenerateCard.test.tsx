// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RegenerateCard, { REGENERATE_PRESETS } from './RegenerateCard';

let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

it('sends a preset or typed feedback, cancels on Escape, and shows progress while busy', () => {
  const onSubmit = vi.fn(); const onCancel = vi.fn();
  act(() => { root.render(<RegenerateCard busy={false} onSubmit={onSubmit} onCancel={onCancel} />); });
  const presets = [...host.querySelectorAll('button')].filter((b) => (REGENERATE_PRESETS as readonly string[]).includes(b.textContent ?? ''));
  expect(presets).toHaveLength(REGENERATE_PRESETS.length);
  act(() => { presets[1].click(); });
  expect(onSubmit).toHaveBeenCalledWith(REGENERATE_PRESETS[1]);
  const input = host.querySelector('input')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '再委婉些'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onSubmit).toHaveBeenLastCalledWith('再委婉些');
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(onCancel).toHaveBeenCalled();
  act(() => { root.render(<RegenerateCard busy onSubmit={onSubmit} onCancel={onCancel} />); });
  expect(host.textContent).toContain('正在重写');
  expect(host.querySelector('input')).toBeNull();
});
