// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import SheetAuditPanel from './SheetAuditPanel';
import { workbookFromCreateSheets } from '../../../shared/sheetContent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((h) => h.remove()));

function mount(values: Array<Array<string | number | null>>, formulas: Array<{ cell: string; formula: string }> = []) {
  const made = workbookFromCreateSheets([{ name: 'Data', values, formulas }]);
  if ('error' in made) throw new Error(made.error);
  const handlers = { onFocus: vi.fn(), onFix: vi.fn(), onClose: vi.fn() };
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  act(() => createRoot(host).render(createElement(SheetAuditPanel, { content: made.content, busy: false, ...handlers })));
  return { host, ...handlers };
}

it('says so when the workbook is clean, with what was scanned', () => {
  const { host } = mount([[1], [2]]);
  expect(host.textContent).toContain('没有发现问题');
  expect(host.textContent).not.toContain('让 AI 修复');
});

it('lists findings with their fix, jumps to the cell on click, and hands the fixes to the agent', () => {
  const { host, onFocus, onFix } = mount([[10], [20], ['30'], [40]]);
  expect(host.textContent).toContain('文本型数字');
  expect(host.textContent).toContain('A3');
  expect(host.textContent).toContain('建议：30');
  act(() => { host.querySelector<HTMLButtonElement>('ul button')!.click(); });
  expect(onFocus).toHaveBeenCalledWith({ sheetId: 'sheet-1', range: 'A3' });
  act(() => { [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('让 AI 修复'))!.click(); });
  expect(onFix).toHaveBeenCalled();
});
