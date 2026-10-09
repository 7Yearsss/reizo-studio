import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createArtifactTools } from './artifactTools';
import { sheetReviewAdapter } from './sheetReviewAdapter';
import { parseSheetContent, serializeSheetContent, workbookFromCreateSheets } from '../../../shared/sheetContent';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));

async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'sheet-review-'));
  const artifacts = createArtifactStore(db, root);
  const reviews = createArtifactReviewStore(db, artifacts, root, { sheet: sheetReviewAdapter });
  const created = workbookFromCreateSheets([{ name: 'Data', values: [['k', 'v'], ['a', 1], ['b', 2]], formulas: [{ cell: 'B4', formula: '=SUM(B2:B3)' }] }]);
  if ('error' in created) throw new Error(created.error);
  const artifact = await artifacts.create({ sessionId: 's', name: 'Book.xlsx', kind: 'sheet', source: 'manual', content: serializeSheetContent(created.content) });
  const tools = createArtifactTools({ sessionId: 's', artifactStore: artifacts, reviews });
  const call = (name: string, args: unknown) => ((tools as Record<string, { execute?: unknown }>)[name]!.execute as (args: unknown, options: unknown) => Promise<Record<string, unknown>>)(args, {});
  return { artifacts, reviews, artifact, call };
}

it('proposes sheet edits without touching the workbook until accepted', async () => {
  const { artifacts, reviews, artifact, call } = await fixture();
  const out = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [
    { op: 'setValues', sheet: 'Data', start: 'B2', values: [[10]] },
    { op: 'addSheet', name: 'Summary', values: [['total']], formulas: [{ cell: 'B1', formula: '=SUM(Data!B2:B3)' }] },
  ] });
  expect(out).toMatchObject({ ok: true, pending: 2 });
  expect((await artifacts.get(artifact.id))!.version).toBe(1);
  const review = reviews.get(String(out.reviewId))!;
  expect(review.changes[0]!.label).toContain('Data!B2');
  expect(review.changes[0]!.before).toContain('Data!B2: 1');
  const accepted = await reviews.decide({ id: review.id, sessionId: 's', expectedReviewVersion: review.reviewVersion, changeIds: [review.changes[1]!.id], decision: 'accept' });
  const saved = parseSheetContent((await artifacts.get(artifact.id))!.content)!;
  expect(saved.sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Summary']);
  expect(saved.sheets[0]!.cells['1']!['1']!.v).toBe(1);
  expect(accepted.changes.some((change) => change.status === 'pending')).toBe(true);
  const done = await reviews.decide({ id: review.id, sessionId: 's', expectedReviewVersion: accepted.reviewVersion, changeIds: [review.changes[0]!.id], decision: 'accept' });
  expect(done.status).toBe('accepted');
  expect(parseSheetContent((await artifacts.get(artifact.id))!.content)!.sheets[0]!.cells['1']!['1']!.v).toBe(10);
});

it('rejects overlapping, no-op, or dependent operations in one batch', async () => {
  const { artifact, call } = await fixture();
  const overlap = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [
    { op: 'setValues', sheet: 'Data', start: 'A1', values: [[1, 2]] },
    { op: 'clearRange', sheet: 'Data', range: 'B1:B3' },
  ] });
  expect(overlap).toMatchObject({ ok: false, error: expect.stringContaining('重叠') });
  expect(await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'setValues', sheet: 'Data', start: 'A1', values: [['k']] }] })).toMatchObject({ ok: false, error: expect.stringContaining('没有实际修改') });
  expect(await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'addSheet', name: 'New' }, { op: 'setValues', sheet: 'New', start: 'A1', values: [[1]] }] })).toMatchObject({ ok: false, error: expect.stringContaining('第 2 项') });
  expect(await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 2, operations: [{ op: 'setValues', sheet: 'Data', start: 'C1', values: [[1]] }] })).toMatchObject({ ok: false });
});

it('keeps generate_sheet create-only when review is available', async () => {
  const { artifact, call } = await fixture();
  expect(await call('generate_sheet', { title: 'x', sourceArtifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'setValues', start: 'A1', values: [[1]] }] })).toMatchObject({ ok: false, error: expect.stringContaining('propose_sheet_edits') });
});

it('proposes a pivot table through review and exposes it in read_sheet', async () => {
  const { artifacts, reviews, artifact, call } = await fixture();
  const out = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [
    { op: 'upsertPivot', pivot: { name: '按k汇总', source: { sheet: 'Data', range: 'A1:B3' }, rows: ['k'], values: [{ field: 'v', agg: 'sum' }], target: { newSheet: 'Pivot' } } },
  ] });
  expect(out).toMatchObject({ ok: true, pending: 1 });
  const review = reviews.get(String(out.reviewId))!;
  expect(review.changes[0]!.label).toContain('透视表「按k汇总」→ 新工作表「Pivot」');
  await reviews.decide({ id: review.id, sessionId: 's', expectedReviewVersion: review.reviewVersion, changeIds: [review.changes[0]!.id], decision: 'accept' });
  const read = await call('read_sheet', { artifactId: artifact.id });
  expect(read.pivots).toMatchObject([{ name: '按k汇总', source: 'Data!A1:B3', output: 'Pivot!A1:B4', rows: ['k'] }]);
  expect(parseSheetContent((await artifacts.get(artifact.id))!.content)!.sheets[1]!.cells['1']!['1']!.f).toContain('SUMIFS');
});

it('proposes a pivot chart through review', async () => {
  const { reviews, artifact, call } = await fixture();
  const pivot = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'upsertPivot', pivot: { source: { sheet: 'Data', range: 'A1:B3' }, rows: ['k'], values: [{ field: 'v', agg: 'sum' }], target: { newSheet: 'P' } } }] });
  const first = reviews.get(String(pivot.reviewId))!;
  await reviews.decide({ id: first.id, sessionId: 's', expectedReviewVersion: first.reviewVersion, changeIds: [first.changes[0]!.id], decision: 'accept' });
  const read = await call('read_sheet', { artifactId: artifact.id });
  const pivotId = (read.pivots as Array<{ id: string }>)[0]!.id;
  const out = await call('propose_sheet_edits', { artifactId: artifact.id, expectedVersion: read.version, operations: [{ op: 'upsertChart', chart: { pivotId, type: 'pie' } }] });
  expect(out).toMatchObject({ ok: true, pending: 1 });
  const review = reviews.get(String(out.reviewId))!;
  expect(review.changes[0]!.label).toContain('新增图表');
  await reviews.decide({ id: review.id, sessionId: 's', expectedReviewVersion: review.reviewVersion, changeIds: [review.changes[0]!.id], decision: 'accept' });
  expect((await call('read_sheet', { artifactId: artifact.id })).charts).toMatchObject([{ type: 'pie', source: expect.stringContaining('透视表') }]);
});
