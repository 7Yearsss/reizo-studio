import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import pptxgen from 'pptxgenjs';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createPresentationsRouter } from './presentations';
import { createPresentation, parsePresentation } from '../../../shared/presentationContent';
const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = openDb(':memory:'); handles.push(db); const root = mkdtempSync(path.join(tmpdir(), 'ppt-import-route-'));
  const artifacts = createArtifactStore(db, root); const sessions = createSqliteSessionStore(db); const session = await sessions.create('PPT import');
  return { artifacts, session, router: createPresentationsRouter(artifacts, sessions) };
}
it('imports a binary PPTX into an editable deck while keeping the exact original attachment', async () => {
  const f = await fixture(); const pptx = new pptxgen(); pptx.layout = 'LAYOUT_WIDE'; pptx.addSlide().addText('Imported original', { x: 1, y: 1, w: 8, h: 1 });
  const bytes = new Uint8Array(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
  const response = await f.router.request(`/${f.session.id}/presentations/import?name=fixture.pptx`, { method: 'POST', body: bytes });
  expect(response.status).toBe(201); const { artifact } = await response.json();
  const content = parsePresentation(artifact.content)!; expect(content.slides).toHaveLength(1); expect(artifact.content).toContain('Imported original');
  const original = f.artifacts.getMeta(content.originalArtifactId!)!;
  expect(original.sessionId).toBe(f.session.id); expect(original.kind).toBe('binary');
  expect(new Uint8Array(await f.artifacts.readBlob(original.id, 1))).toEqual(bytes);
});
it('restores a recovery file as a new independent deck and strips foreign attachment references', async () => {
  const f = await fixture(); const content = { ...createPresentation('Recovery'), originalArtifactId: 'foreign-file' };
  const body = JSON.stringify(content);
  const first = await f.router.request(`/${f.session.id}/presentations/import?name=restore.reizo-ppt.json`, { method: 'POST', body });
  const second = await f.router.request(`/${f.session.id}/presentations/import?name=restore.reizo-ppt.json`, { method: 'POST', body });
  expect(first.status).toBe(201); expect(second.status).toBe(201);
  const a = (await first.json()).artifact; const b = (await second.json()).artifact;
  expect(a.id).not.toBe(b.id); expect(parsePresentation(a.content)?.originalArtifactId).toBeUndefined();
  expect((await f.artifacts.listBySession(f.session.id))).toHaveLength(2);
});
it('rejects missing sessions and unsupported files without leaving partial attachments', async () => {
  const f = await fixture();
  expect((await f.router.request('/missing/presentations/import?name=x.pptx', { method: 'POST', body: 'invalid' })).status).toBe(404);
  expect((await f.router.request(`/${f.session.id}/presentations/import?name=x.ppt`, { method: 'POST', body: 'invalid' })).status).toBe(400);
  expect((await f.router.request(`/${f.session.id}/presentations/import?name=x.pptx`, { method: 'POST', body: 'invalid' })).status).toBe(400);
  expect(await f.artifacts.listBySession(f.session.id)).toHaveLength(0);
});
