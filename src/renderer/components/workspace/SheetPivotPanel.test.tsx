// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCell, workbookFromCreateSheets, type SheetArtifactContent } from '../../../shared/sheetContent';
import { sheetPivots } from '../../../shared/sheetPivot';
import SheetPivotPanel from './SheetPivotPanel';

let root: Root;
let element: HTMLDivElement;
function sales(): SheetArtifactContent {
  const result = workbookFromCreateSheets([{ name: '销售', values: [['地区', '销售额'], ['华东', 100], ['华北', 80], ['华东', 20]] }]);
  if ('error' in result) throw new Error(result.error);
  return result.content;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

it('builds a pivot from checked fields and commits it against the latest content', async () => {
  const content = sales();
  let saved: SheetArtifactContent | undefined;
  const commit = vi.fn(async (mutate: (c: SheetArtifactContent) => SheetArtifactContent) => { saved = mutate(content); return true; });
  await act(async () => { root.render(<SheetPivotPanel content={content} selection={{ sheetId: content.sheets[0]!.id, range: 'B2' }} busy={false} commit={commit} onClose={() => undefined} />); });
  expect((element.querySelector('input[aria-label="数据源范围"]') as HTMLInputElement).value).toBe('A1:B4');
  const generate = () => [...element.querySelectorAll('button')].find((b) => b.textContent === '生成透视表')!;
  expect(generate().disabled).toBe(true);
  await act(async () => { (element.querySelector('[aria-label="地区"]') as HTMLButtonElement).click(); });
  await act(async () => { (element.querySelector('[aria-label="销售额"]') as HTMLButtonElement).click(); });
  expect(element.textContent).toContain('行：地区 · 值：求和(销售额)');
  await act(async () => { generate().click(); });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(sheetPivots(saved!)).toMatchObject([{ rows: ['地区'], values: [{ field: '销售额', agg: 'sum' }] }]);
  const pivotSheet = saved!.sheets.find((s) => s.name === '透视表 1')!;
  expect([0, 1, 2, 3].map((row) => getCell(pivotSheet, row, 0)?.v)).toEqual(['地区', '华北', '华东', '总计']);
});

it('shows a placement error instead of committing', async () => {
  const content = sales();
  const commit = vi.fn(async () => true);
  await act(async () => { root.render(<SheetPivotPanel content={content} busy={false} commit={commit} onClose={() => undefined} />); });
  await act(async () => { (element.querySelector('[aria-label="销售额"]') as HTMLButtonElement).click(); });
  const name = element.querySelector('input[aria-label="新工作表名称"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(name, '销售'); name.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { [...element.querySelectorAll('button')].find((b) => b.textContent === '生成透视表')!.click(); });
  expect(commit).not.toHaveBeenCalled();
  expect(element.textContent).toContain('工作表「销售」已存在');
});
