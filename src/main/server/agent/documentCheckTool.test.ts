import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { documentReviewAdapter } from './documentReviewAdapter';
import { createDocumentTools } from './documentTools';
import { documentFromHtml } from './documentIO';
import { microCompactToolResult } from './microCompact';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });
const call = async (tools: Record<string, { execute?: unknown }>, name: string, args: unknown) =>
  (tools[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, {});

it('check_document reports findings with block ids and fixes the agent can turn into edits, uncut by the history clip', async () => {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'doc-check-'));
  const artifacts = createArtifactStore(db, root);
  const reviews = createArtifactReviewStore(db, artifacts, root, { doc: documentReviewAdapter });
  const html = '<p>一、背景</p><p>三、计划</p><p>本次会议讨论预算,人员,进度。</p>' + Array.from({ length: 40 }, () => '<p>讨论预算,安排人员,确定进度。</p>').join('');
  const doc = await artifacts.create({ sessionId: 's', name: '报告', kind: 'doc', source: 'manual', content: JSON.stringify(documentFromHtml(html)) });
  const tools = createDocumentTools({ sessionId: 's', artifacts, reviews });
  const out = await call(tools, 'check_document', { artifactId: doc.id });
  expect(out).toMatchObject({ ok: true, version: 1 });
  const findings = out.findings as { kind: string; blockId: string; start: number; end: number; replacement?: string }[];
  expect(findings.length).toBeLessThanOrEqual(50);
  expect(out.total as number).toBeGreaterThan(50);
  expect(findings.some((f) => f.kind === 'numbering')).toBe(true);
  expect(findings.find((f) => f.kind === 'punctuation')).toMatchObject({ replacement: '，' });
  expect(typeof findings[0].blockId).toBe('string');
  expect(String(out.note)).toContain('共');
  const json = JSON.stringify(out);
  expect(microCompactToolResult('check_document', json)).toBe(json);
  expect((await call(tools, 'check_document', { artifactId: 'missing' })).ok).toBe(false);
});
