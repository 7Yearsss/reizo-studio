import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { documentReviewAdapter } from './documentReviewAdapter';
import { createDocumentTools } from './documentTools';
import { createArtifactTools } from './artifactTools';
import { buildSheetContext } from './sheetContext';
import { documentFromHtml } from './documentIO';
import { microCompactToolResult } from './microCompact';
import { READ_PAGE_BUDGET, takeWithinBudget } from './readBudget';
import { emptyWorkbook, putSheetCell } from '../../../shared/sheetContent';
import { summarizeSheet } from '../../../shared/sheetReferences';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });
function setup() {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'office-read-'));
  const artifacts = createArtifactStore(db, root);
  const reviews = createArtifactReviewStore(db, artifacts, root, { doc: documentReviewAdapter });
  return { artifacts, reviews };
}
const call = async (tools: Record<string, { execute?: unknown }>, name: string, args: unknown) =>
  (tools[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, {});
/** What the model actually receives for a tool result after the history clip. */
const seenByModel = (tool: string, value: unknown) => microCompactToolResult(tool, JSON.stringify(value));
function bigWorkbook(rows: number, cols: number) {
  const book = emptyWorkbook('数据');
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) putSheetCell(book.sheets[0], r, c, { v: `value-${r}-${c}-${'x'.repeat(30)}` });
  return book;
}

describe('takeWithinBudget', () => {
  it('stops at the budget but always returns at least one item', () => {
    expect(takeWithinBudget(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)], 250)).toHaveLength(2);
    expect(takeWithinBudget(['z'.repeat(1000), 'y'], 50)).toEqual(['z'.repeat(1000)]);
    expect(takeWithinBudget([])).toEqual([]);
  });
});

describe('read_document paging', () => {
  it('pages a long document by size with nextOffset, and the model sees every page unclipped', async () => {
    const { artifacts, reviews } = setup();
    const html = Array.from({ length: 60 }, (_, i) => `<p>第${i}段 ${'内容'.repeat(200)}</p>`).join('');
    const doc = await artifacts.create({ sessionId: 's', name: '长文档', kind: 'doc', source: 'manual', content: JSON.stringify(documentFromHtml(html)) });
    const tools = createDocumentTools({ sessionId: 's', artifacts, reviews });
    const seen: string[] = [];
    let offset = 0; let pages = 0;
    for (;;) {
      const out = await call(tools, 'read_document', { artifactId: doc.id, offset });
      expect(out.ok).toBe(true);
      const json = JSON.stringify(out);
      expect(seenByModel('read_document', out)).toBe(json); // no mid-JSON clip
      expect(json.length).toBeLessThan(READ_PAGE_BUDGET + 1500);
      for (const b of out.blocks as { id: string }[]) seen.push(b.id);
      pages++;
      if (out.nextOffset == null) break;
      expect(out.nextOffset).toBe(offset + (out.returned as number));
      offset = out.nextOffset as number;
      expect(pages).toBeLessThan(80);
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it('puts version/pending metadata before the bulky blocks', async () => {
    const { artifacts, reviews } = setup();
    const doc = await artifacts.create({ sessionId: 's', name: 'd', kind: 'doc', source: 'manual', content: JSON.stringify(documentFromHtml('<p>x</p>')) });
    const keys = Object.keys(await call(createDocumentTools({ sessionId: 's', artifacts, reviews }), 'read_document', { artifactId: doc.id }));
    expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('blocks'));
    expect(keys.indexOf('pendingReviews')).toBeLessThan(keys.indexOf('blocks'));
  });
});

describe('sheet previews', () => {
  it('summarizeSheet stops at a row boundary and says where to continue', () => {
    const book = bigWorkbook(60, 10);
    const small = summarizeSheet(book, undefined, 1500);
    expect(small.length).toBeLessThan(2600);
    expect(small).toContain('A1=value-0-0');
    expect(small).toContain('Output budget reached before row');
    expect(summarizeSheet(book).length).toBeGreaterThan(small.length);
  });

  it('read_sheet output survives the model-side clip', async () => {
    const { artifacts } = setup();
    const sheet = await artifacts.create({ sessionId: 's', name: '大表.xlsx', kind: 'sheet', source: 'manual', content: JSON.stringify(bigWorkbook(80, 20)) });
    const out = await call(createArtifactTools({ sessionId: 's', artifactStore: artifacts }), 'read_sheet', { artifactId: sheet.id });
    expect(seenByModel('read_sheet', out)).toBe(JSON.stringify(out));
    expect(String(out.summary)).toContain('Output budget reached');
  });

  it('auto-attached sheet context is capped per sheet and in total', async () => {
    const { artifacts } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await artifacts.create({ sessionId: 's', name: `表${i}.xlsx`, kind: 'sheet', source: 'manual', content: JSON.stringify(bigWorkbook(80, 20)) })).id);
    const block = await buildSheetContext(artifacts, 's', ids.map((artifactId) => ({ artifactId })));
    expect(block.length).toBeGreaterThan(0);
    expect(block.length).toBeLessThan(11_000);
    expect(block).toContain('cell preview omitted'); // later sheets keep identity, not data
    for (const id of ids) expect(block).toContain(id);
  });
});
