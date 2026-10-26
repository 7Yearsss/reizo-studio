import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactTools } from './artifactTools';
import { createArtifactsRouter } from '../routes/artifacts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
async function fixture(sessionId = 'chat') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-generated-file-'));
  const db = openDb(':memory:');
  cleanup.push(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const store = createArtifactStore(db, root);
  // Deliberately no workspacePath: normal customer chats must still produce files.
  const tools = createArtifactTools({ sessionId, artifactStore: store }) as Record<string, { execute?: unknown }>;
  const generate = async (input: unknown) => {
    expect(tools.generate_file?.execute).toBeTypeOf('function');
    return (tools.generate_file.execute as (a: unknown, b: unknown) => Promise<Record<string, unknown>>)(input, {});
  };
  return { store, generate };
}

describe('chat file generation without a workspace', () => {
  it('persists a real UTF-8 TXT artifact and serves the exact downloadable contents', async () => {
    const { store, generate } = await fixture();
    const content = '出师表\n诸葛亮\n\n臣亮言：先帝创业未半而中道崩殂。\n';
    const result = await generate({ filename: '出师表.txt', content });
    expect(result).toMatchObject({ ok: true, name: '出师表.txt', kind: 'text', version: 1 });
    const artifact = await store.get(result.artifactId as string);
    expect(artifact).toMatchObject({ sessionId: 'chat', content, byteSize: Buffer.byteLength(content, 'utf8'), source: 'generated' });
    const response = await createArtifactsRouter(store).request(`/${result.artifactId}/download?v=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('出师表.txt'));
    expect(response.headers.get('content-type')).toContain('charset=utf-8');
    expect(await response.text()).toBe(content);
  });
  it('keeps CSV as a downloadable CSV and Markdown as Markdown', async () => {
    const { store, generate } = await fixture();
    const csv = await generate({ filename: '名单.csv', content: '姓名,分数\n小明,90\n' });
    expect(await store.get(csv.artifactId as string)).toMatchObject({ kind: 'text', mimeType: 'text/csv' });
    const md = await generate({ filename: '说明.md', content: '# 标题\n\n**完成**' });
    expect(await store.get(md.artifactId as string)).toMatchObject({ kind: 'markdown' });
  });
  it('rejects fake binary formats and unsafe names without creating artifacts', async () => {
    const { store, generate } = await fixture();
    for (const filename of ['report.pdf', 'table.xlsx', '../出师表.txt', 'C:\\out.txt', 'CON.txt']) {
      expect(await generate({ filename, content: 'not a binary file' })).toMatchObject({ ok: false });
    }
    expect(await store.listBySession('chat')).toHaveLength(0);
  });
});
