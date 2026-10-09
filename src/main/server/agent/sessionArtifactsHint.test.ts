import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createDocumentContent } from '../../../shared/documentContent';
import { createPresentation } from '../../../shared/presentationContent';
import { describeSessionArtifacts } from './sessionArtifactsHint';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const artifacts = createArtifactStore(db, mkdtempSync(path.join(tmpdir(), 'artifact-hint-')));
  // The store validates doc/presentation/html content on create, so give each kind a valid empty body.
  const body = { doc: JSON.stringify(createDocumentContent()), presentation: JSON.stringify(createPresentation()), html: '<!doctype html><title>t</title><p>x</p>', sheet: '{}', markdown: '# x' };
  const add = (sessionId: string, name: string, kind: keyof typeof body) =>
    artifacts.create({ sessionId, name, kind, source: 'manual', content: body[kind] });
  return { artifacts, add };
}

it('lists editable files by id only, scoped to the session, with no content or version', async () => {
  const { artifacts, add } = fixture();
  const doc = await add('s1', '合同.docx', 'doc');
  const sheet = await add('s1', '预算.xlsx', 'sheet');
  await add('s1', 'notes.md', 'markdown');
  await add('other', '别的会话.docx', 'doc');
  const hint = await describeSessionArtifacts(artifacts, 's1');
  expect(hint).toContain(`Doc "合同.docx" id=${doc.id}`);
  expect(hint).toContain(`Excel "预算.xlsx" id=${sheet.id}`);
  expect(hint).not.toContain('notes.md');
  expect(hint).not.toContain('别的会话');
  expect(hint).not.toContain('version');
  expect(hint).toContain('never list_dir/find_files/grep/read_file');
});

it('stays bounded: per-kind and total caps, truncated names, hard ceiling', async () => {
  const { artifacts, add } = fixture();
  const oldestDoc = await add('s1', 'oldest.docx', 'doc'); // oldest of everything: must still be listed as the only Doc
  for (let i = 0; i < 5; i++) await add('s1', `book-${i}.xlsx`, 'sheet');
  for (let i = 0; i < 5; i++) await add('s1', `deck-${i}.pptx`, 'presentation');
  for (let i = 0; i < 5; i++) await add('s1', `page-${i}.html`, 'html');
  for (let i = 0; i < 20; i++) await add('s1', `${'很长的文件名'.repeat(30)}-${i}.docx`, 'doc');
  const hint = await describeSessionArtifacts(artifacts, 's1');
  const entries = hint.split('\n').filter((l) => l.startsWith('- '));
  expect(entries.length).toBeLessThanOrEqual(8);
  for (const label of ['Doc', 'Excel', 'PPT', 'HTML']) {
    const n = entries.filter((l) => l.startsWith(`- ${label} `)).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3);
  }
  expect(hint).not.toContain(oldestDoc.id);
  expect(hint).toContain('more — call');
  expect(hint).toContain('…"');
  expect(hint.length).toBeLessThanOrEqual(1400);
});

it('never starves a kind: an old Doc is still listed when 8+ newer files of other kinds exist', async () => {
  const { artifacts, add } = fixture();
  const doc = await add('s1', 'imported.docx', 'doc');
  for (let i = 0; i < 4; i++) await add('s1', `book-${i}.xlsx`, 'sheet');
  for (let i = 0; i < 4; i++) await add('s1', `deck-${i}.pptx`, 'presentation');
  for (let i = 0; i < 4; i++) await add('s1', `page-${i}.html`, 'html');
  expect(await describeSessionArtifacts(artifacts, 's1')).toContain(`id=${doc.id}`);
});

it('adds nothing when the session has no editable files', async () => {
  const { artifacts, add } = fixture();
  await add('s1', 'notes.md', 'markdown');
  expect(await describeSessionArtifacts(artifacts, 's1')).toBe('');
  expect(await describeSessionArtifacts(artifacts, 'empty')).toBe('');
});
