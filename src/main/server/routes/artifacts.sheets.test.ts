import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb } from '../db/client';
import { createArtifactStore, ArtifactVersionConflictError } from '../storage/artifactStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createArtifactsRouter, createSessionArtifactsRouter } from './artifacts';
import { emptyWorkbook, parseSheetContent, serializeSheetContent } from '../../../shared/sheetContent';
import { createArtifactTools } from '../agent/artifactTools';
import { buildSheetContext } from '../agent/sheetContext';

const handles: ReturnType<typeof openDb>[] = [];
async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const store = createArtifactStore(db, mkdtempSync(path.join(tmpdir(), 'sheet-test-')));
  const sessions = createSqliteSessionStore(db);
  const session = await sessions.create('Test');
  const artifact = await store.create({ sessionId: session.id, name: 'Budget.xlsx', kind: 'sheet', content: serializeSheetContent(emptyWorkbook()), source: 'manual' });
  return { store, sessions, session, artifact };
}
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });

describe('sheet import and edits', () => {
  it('prevents diagram tools and generic workspace writes from replacing a managed workbook', async () => {
    const { store, session, artifact } = await fixture();
    const tools = createArtifactTools({ sessionId: session.id, artifactStore: store });
    const diagram = tools.generate_diagram.execute as unknown as (args: unknown, options: unknown) => Promise<{ ok: boolean }>;
    expect((await diagram({ title: 'wrong tool', sourceArtifactId: artifact.id, mermaid: 'graph TD; A-->B' }, {})).ok).toBe(false);
    const replacement = await store.createOrAddVersion({ sessionId: session.id, name: artifact.name, kind: 'text', source: 'generated', content: 'workspace output', origin: { surface: 'chat' } });
    expect(replacement.id).not.toBe(artifact.id);
    expect((await store.get(artifact.id))?.content).toBe(artifact.content);
    expect((await store.get(artifact.id))?.version).toBe(1);
  });
  it('imports binary XLSX and preserves styled data', async () => {
    const { store, sessions, session } = await fixture();
    const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('预算');
    sheet.getCell('A1').value = '金额'; sheet.getCell('A1').font = { bold: true };
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const router = createSessionArtifactsRouter(store, sessions);
    const response = await router.request(`/${session.id}/artifacts/sheets/import?name=budget.xlsx`, { method: 'POST', body: bytes });
    expect(response.status).toBe(201);
    const { artifact } = await response.json();
    expect(artifact.kind).toBe('sheet');
    expect(parseSheetContent(artifact.content)?.sheets[0].cells['0']['0'].v).toBe('金额');
    expect(parseSheetContent(artifact.content)?.univerSnapshot).toBeDefined();
    const invalid = await router.request(`/${session.id}/artifacts/sheets/import?name=budget.xlsm`, { method: 'POST', body: bytes });
    expect(invalid.status).toBe(400);
  });
  it('only one simultaneous save can replace a given base version', async () => {
    const { store, artifact } = await fixture();
    const saves = await Promise.allSettled(['first', 'second'].map((name) => store.addVersion(artifact.id, { expectedVersion: 1, content: serializeSheetContent(emptyWorkbook(name)), origin: { surface: 'manual_edit' } })));
    expect(saves.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = saves.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ArtifactVersionConflictError);
    expect((await store.get(artifact.id))?.version).toBe(2);
    const router = createArtifactsRouter(store);
    const response = await router.request(`/${artifact.id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: artifact.content, expectedVersion: 1 }) });
    expect(response.status).toBe(409);
  });
  it('rejects an oversized live snapshot instead of silently storing a truncated grid', async () => {
    const { store, artifact } = await fixture();
    const content = parseSheetContent(artifact.content);
    if (!content) throw new Error('invalid fixture');
    content.univerSnapshot = { sheets: { 'sheet-1': { rowCount: 2001, columnCount: 20, cellData: { '2000': { '0': { v: 'must not disappear' } } } } } };
    const response = await createArtifactsRouter(store).request(`/${artifact.id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, content: serializeSheetContent(content) }) });
    expect(response.status).toBe(400);
    expect((await store.get(artifact.id))?.version).toBe(1);
  });
  it('scopes agent reads and edits to this session and protects newer user edits', async () => {
    const { store, session, artifact } = await fixture();
    const tools = createArtifactTools({ sessionId: session.id, artifactStore: store });
    const call = (name: keyof typeof tools, args: unknown) => (tools[name].execute as unknown as (args: unknown, options: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: 'test', messages: [] });
    const foreign = await store.create({ sessionId: 'other', name: 'private.xlsx', kind: 'sheet', content: artifact.content, source: 'manual' });
    expect((await call('read_sheet', { artifactId: foreign.id })).ok).toBe(false);
    expect(await buildSheetContext(store, session.id, [{ artifactId: foreign.id }])).toBe('');
    await store.addVersion(artifact.id, { expectedVersion: 1, content: serializeSheetContent(emptyWorkbook('User edit')), origin: { surface: 'manual_edit' } });
    expect((await call('generate_sheet', { title: 'Budget', sourceArtifactId: artifact.id, expectedVersion: 1, operations: [{ op: 'setValues', start: 'A1', values: [[999]] }] })).ok).toBe(false);
    const read = await call('read_sheet', { artifactId: artifact.id });
    expect(read.version).toBe(2);
    expect((await call('generate_sheet', { title: 'Budget', sourceArtifactId: artifact.id, expectedVersion: 2, operations: [{ op: 'setValues', start: 'A1', values: [[42]] }] })).ok).toBe(true);
    expect(parseSheetContent((await store.get(artifact.id))!.content)?.sheets[0].cells['0']['0'].v).toBe(42);
  });
});
