import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createArtifactTools } from './artifactTools';
import { sheetReviewAdapter } from './sheetReviewAdapter';
import { serializeSheetContent, workbookFromCreateSheets } from '../../../shared/sheetContent';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));

async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'sheet-audit-'));
  const artifacts = createArtifactStore(db, root);
  const reviews = createArtifactReviewStore(db, artifacts, root, { sheet: sheetReviewAdapter });
  const created = workbookFromCreateSheets([{
    name: 'Data',
    values: [['单价', '数量', '金额'], [3, 2, null], [4, 5, null], [5, 1, null], [6, 7, null], [7, 3, null]],
    formulas: [2, 3, 4, 5, 6].map((r) => ({ cell: `C${r}`, formula: `=A${r}*B${r}` })),
  }]);
  if ('error' in created) throw new Error(created.error);
  const artifact = await artifacts.create({ sessionId: 's', name: 'Book.xlsx', kind: 'sheet', source: 'manual', content: serializeSheetContent(created.content) });
  const tools = createArtifactTools({ sessionId: 's', artifactStore: artifacts, reviews });
  const call = (name: string, args: unknown) => ((tools as Record<string, { execute?: unknown }>)[name]!.execute as (args: unknown, options: unknown) => Promise<Record<string, unknown>>)(args, {});
  return { artifact, call };
}

it('audits a workbook and reports nothing for a clean one', async () => {
  const { artifact, call } = await fixture();
  const out = await call('check_sheet', { artifactId: artifact.id });
  expect(out).toMatchObject({ ok: true, total: 0, version: 1 });
});

it('refuses a workbook that is not in this session', async () => {
  const { call } = await fixture();
  expect(await call('check_sheet', { artifactId: 'nope' })).toMatchObject({ ok: false });
});

it('warns when a proposal replaces formulas with constants, and when it breaks a column rule', async () => {
  const { artifact, call } = await fixture();
  const out = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [
    { op: 'setValues', sheet: 'Data', start: 'C3', values: [[99]] },
    { op: 'setFormulas', sheet: 'Data', start: 'C5', formulas: [['=A5+B5']] },
  ] });
  expect(out.ok).toBe(true);
  const warnings = out.warnings as string[];
  expect(warnings[0]).toContain('C3');
  expect(warnings.join('\n')).toContain('C5');
});

it('stays quiet for an edit that keeps the formulas live', async () => {
  const { artifact, call } = await fixture();
  const out = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'setValues', sheet: 'Data', start: 'A7', values: [[8]] }] });
  expect(out.ok).toBe(true);
  expect(out.warnings).toBeUndefined();
});
