import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { buildSheetContext } from './sheetContext';
import { splitSheetContext } from '../../../shared/sheetReferences';
import { serializeSheetContent, workbookFromCreateSheets } from '../../../shared/sheetContent';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));

async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const store = createArtifactStore(db, mkdtempSync(path.join(tmpdir(), 'sheet-context-')));
  const created = workbookFromCreateSheets([{ name: 'Sheet1', values: [['学号', '姓名'], ['1', 'a']] }]);
  if ('error' in created) throw new Error(created.error);
  const artifact = await store.create({ sessionId: 's', name: '工作簿.xlsx', kind: 'sheet', source: 'manual', content: serializeSheetContent(created.content) });
  return { store, artifact };
}
const contextOf = (block: string) => JSON.parse(/<sheet-context>(.*)<\/sheet-context>/.exec(block)![1]).context as string;

it('tells the agent the picked range is the target of the request', async () => {
  const { store, artifact } = await fixture();
  const block = await buildSheetContext(store, 's', [{ artifactId: artifact.id, sheetName: 'Sheet1', range: 'A1:B9' }]);
  const text = contextOf(block);
  expect(text).toContain('User-selected range Sheet1!A1:B9');
  expect(text).toContain('only cells inside it');
});

it('numbers picked ranges so the user can cite them as [n], and keeps the number for display', async () => {
  const { store, artifact } = await fixture();
  const block = await buildSheetContext(store, 's', [
    { artifactId: artifact.id, sheetName: 'Sheet1', range: 'A1:A2', label: 1 },
    { artifactId: artifact.id, sheetName: 'Sheet1', range: 'B1:B2', label: 2 },
  ]);
  const text = contextOf(block);
  expect(text).toContain('Range [1] Sheet1!A1:A2');
  expect(text).toContain('when the user writes [2] they mean this range');
  expect(splitSheetContext(block).refs.map((r) => r.label)).toEqual([1, 2]);
});

it('does not scope a whole-workbook reference', async () => {
  const { store, artifact } = await fixture();
  expect(contextOf(await buildSheetContext(store, 's', [{ artifactId: artifact.id }]))).not.toContain('target of this request');
});
