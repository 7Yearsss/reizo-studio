// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { draftStash } from '../../state/draftStashStore';
import DraftStashMenu from './DraftStashMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('shows nothing until something is shelved, then restores and drops the entry', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onRestore = vi.fn();
  await act(async () => { root.render(<DraftStashMenu onRestore={onRestore} />); });
  expect(host.textContent).toBe('');

  await act(async () => { draftStash.push('帮我写一封邮件\n给客户'); });
  expect(host.textContent).toContain('暂存 1');

  await act(async () => { host.querySelector('button')!.click(); });
  const item = host.querySelector<HTMLElement>('[role=menuitem]')!;
  expect(item.textContent).toBe('帮我写一封邮件 给客户');
  await act(async () => { item.click(); });
  expect(onRestore).toHaveBeenCalledWith('帮我写一封邮件\n给客户');
  expect(host.textContent).toBe('');
  await act(async () => root.unmount());
});

test('a blank draft is not shelved', () => {
  expect(draftStash.push('   ')).toBe(false);
});
