// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptInput, sendDisabledReason } from './prompt-input';

let host: HTMLDivElement;
let root: Root;
function control(label: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing control: ${label}`);
  return element;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('keeps exactly one stop control while a running turn has a draft to queue', async () => {
  const stop = vi.fn(), submit = vi.fn();
  await act(async () => root.render(<PromptInput loading value="下一条消息" onStop={stop} onSubmit={submit} />));
  const stops = host.querySelectorAll<HTMLButtonElement>('[aria-label="Stop generating"]');
  expect(stops).toHaveLength(1);
  await act(async () => stops[0].click());
  expect(stop).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  await act(async () => control('Queue message').click());
  expect(submit).toHaveBeenCalledWith('下一条消息', undefined);
});

it('keeps stop available while waiting on an interaction and the editor is disabled', async () => {
  const stop = vi.fn();
  await act(async () => root.render(<PromptInput disabled onStop={stop} />));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]');
  expect(button).not.toBeNull();
  expect(control('Stop generating').disabled).toBe(false);
  await act(async () => control('Stop generating').click());
  expect(stop).toHaveBeenCalledOnce();
});

it('shows only stop for an empty running draft and restores send when idle', async () => {
  await act(async () => root.render(<PromptInput loading onStop={vi.fn()} />));
  expect(host.querySelectorAll('[aria-label="Stop generating"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Queue message"]')).toBeNull();
  await act(async () => root.render(<PromptInput value="你好" />));
  expect(host.querySelector('[aria-label="Stop generating"]')).toBeNull();
  expect(control('Send prompt').disabled).toBe(false);
});

it('allows an attachment-only message while keeping an ordinary empty draft disabled', async () => {
  const submit = vi.fn();
  await act(async () => root.render(<PromptInput value="" allowEmptySubmit onSubmit={submit} />));
  expect(control('Send prompt').disabled).toBe(false);
  await act(async () => control('Send prompt').click());
  expect(submit).toHaveBeenCalledWith('', undefined);
  await act(async () => root.render(<PromptInput value="" onSubmit={submit} />));
  expect(control('Send prompt').disabled).toBe(true);
});

describe('sendDisabledReason', () => {
  it('names why send is inert and is silent when live', () => {
    expect(sendDisabledReason({ hasDraft: false })).toBe('先输入内容');
    expect(sendDisabledReason({ hasDraft: true, disabled: true })).toBe('暂时无法发送');
    expect(sendDisabledReason({ hasDraft: true })).toBeUndefined();
  });
});
