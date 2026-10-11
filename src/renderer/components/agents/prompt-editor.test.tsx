// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptEditor, type PromptEditorHandle } from './prompt-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const info = (label: number) => (label === 1 ? { kind: '文档', name: 'a.docx', text: '数量' } : label === 2 ? { kind: '文档', name: 'a.docx', text: '长开展工作，班长不在时暂代班长职责' } : undefined);
const chips = { info, open: vi.fn() };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });

function Harness({ initial, onEnter, handle }: { initial: string; onEnter: (sendNow: boolean) => void; handle: React.RefObject<PromptEditorHandle> }) {
  const [value, setValue] = useState(initial);
  return <><PromptEditor ref={handle} value={value} onChange={setValue} chips={chips} onEnter={onEnter} placeholder="输入消息" />
    <output data-testid="draft">{value}</output></>;
}
const draft = () => host.querySelector('output')!.textContent;

it('renders known citations as chips with a quote and keeps the draft string', async () => {
  const handle = createRef<PromptEditorHandle>();
  await act(async () => { root.render(<Harness initial="把[1]改正式，[2]不变，[9]不是" onEnter={vi.fn()} handle={handle} />); });
  const rendered = [...host.querySelectorAll('[data-reference-chip]')];
  expect(rendered.map((el) => el.getAttribute('data-reference-chip'))).toEqual(['1', '2']);
  expect(host.textContent).toContain('数量');
  expect(host.textContent).toContain('长开展工作，班长不在时暂代班…');
  expect(host.textContent).toContain('[9]不是');
  expect(draft()).toBe('把[1]改正式，[2]不变，[9]不是');
});

it('inserts a chip at the caret through the handle and serializes it as [n]', async () => {
  const handle = createRef<PromptEditorHandle>();
  await act(async () => { root.render(<Harness initial="请把" onEnter={vi.fn()} handle={handle} />); });
  await act(async () => { handle.current!.insertReference(2); });
  expect(host.querySelectorAll('[data-reference-chip="2"]')).toHaveLength(1);
  expect(draft()).toBe('请把 [2] ');
});

it('clicking a chip opens its range', async () => {
  const handle = createRef<PromptEditorHandle>();
  await act(async () => { root.render(<Harness initial="[1]" onEnter={vi.fn()} handle={handle} />); });
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-reference-chip="1"] button')!.click(); });
  expect(chips.open).toHaveBeenCalledWith(1);
});

it('Enter sends, Shift+Enter does not, and external value changes replace the content', async () => {
  const onEnter = vi.fn();
  const handle = createRef<PromptEditorHandle>();
  function Controlled() {
    const [value, setValue] = useState('hello');
    return <><PromptEditor ref={handle} value={value} onChange={setValue} chips={chips} onEnter={onEnter} />
      <button type="button" id="swap" onClick={() => setValue('换成[1]了')}>swap</button></>;
  }
  await act(async () => { root.render(<Controlled />); });
  const editable = host.querySelector<HTMLElement>('[role="textbox"]')!;
  await act(async () => { editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
  expect(onEnter).not.toHaveBeenCalled();
  await act(async () => { editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
  expect(onEnter).toHaveBeenCalledWith(true);
  await act(async () => { host.querySelector<HTMLButtonElement>('#swap')!.click(); });
  expect(host.querySelectorAll('[data-reference-chip="1"]')).toHaveLength(1);
  expect(editable.textContent).toContain('换成');
});
