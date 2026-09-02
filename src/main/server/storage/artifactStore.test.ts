import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from './artifactStore';

function freshStore() {
  const handle = openDb(':memory:');
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'reizo-artifacts-'));
  return { store: createArtifactStore(handle, dataRoot), dataRoot, handle };
}

// A 1x1 transparent PNG.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('artifactStore', () => {
  it('creates a text artifact as version 1 inline', async () => {
    const { store } = freshStore();
    const a = await store.create({ sessionId: 's1', name: 'plan.md', content: '# Hi', source: 'generated' });
    expect(a.kind).toBe('markdown');
    expect(a.renderer).toBe('markdown');
    expect(a.version).toBe(1);
    expect(a.versionCount).toBe(1);
    expect(a.content).toBe('# Hi');
    expect(a.byteSize).toBe(4);
  });

  it('appends versions without destroying earlier ones', async () => {
    const { store } = freshStore();
    const a = await store.create({ sessionId: 's1', name: 'plan.md', content: 'v1 text', source: 'generated' });
    const b = await store.addVersion(a.id, { content: 'v2 text', origin: { surface: 'chat', prompt: 'expand it' } });
    expect(b?.version).toBe(2);
    expect(b?.versionCount).toBe(2);
    expect(b?.content).toBe('v2 text');

    const old = await store.get(a.id, 1);
    expect(old?.content).toBe('v1 text');

    const versions = store.listVersions(a.id);
    expect(versions.map((v) => v.n)).toEqual([1, 2]);
    expect(versions[1].origin.prompt).toBe('expand it');
  });

  it('restoreVersion creates a new version copying an old one', async () => {
    const { store } = freshStore();
    const a = await store.create({ sessionId: 's1', name: 'x.md', content: 'first', source: 'generated' });
    await store.addVersion(a.id, { content: 'second', origin: { surface: 'chat' } });
    const restored = await store.restoreVersion(a.id, 1);
    expect(restored?.version).toBe(3);
    expect(restored?.content).toBe('first');
    expect(store.listVersions(a.id)[2].label).toBe('Restored from v1');
  });

  it('stores an image data URL as a blob and serves a raw url', async () => {
    const { store } = freshStore();
    const a = await store.create({
      sessionId: 's1',
      name: 'shot.png',
      content: PNG_DATA_URL,
      source: 'generated',
      kind: 'image',
    });
    expect(a.kind).toBe('image');
    expect(a.content).toBe('');
    expect(a.rawUrl).toBe(`/api/artifacts/${a.id}/raw?v=1`);
    expect(a.byteSize).toBeGreaterThan(60);
    const file = store.blobFilePath(a.id, 1);
    expect(file && existsSync(file)).toBe(true);
  });

  it('createOrAddVersion appends when the name already exists this session', async () => {
    const { store } = freshStore();
    const a = await store.createOrAddVersion({
      sessionId: 's1',
      name: 'notes.md',
      content: 'one',
      source: 'generated',
      origin: { surface: 'chat' },
    });
    const b = await store.createOrAddVersion({
      sessionId: 's1',
      name: 'notes.md',
      content: 'two',
      source: 'generated',
      origin: { surface: 'chat', prompt: 'again' },
    });
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(2);
    // Different session → new artifact.
    const c = await store.createOrAddVersion({
      sessionId: 's2',
      name: 'notes.md',
      content: 'other',
      source: 'generated',
      origin: { surface: 'chat' },
    });
    expect(c.id).not.toBe(a.id);
  });

  it('removeBySession deletes rows and blob dirs', async () => {
    const { store } = freshStore();
    const a = await store.create({ sessionId: 's1', name: 'p.png', content: PNG_DATA_URL, source: 'generated', kind: 'image' });
    await store.create({ sessionId: 's1', name: 'q.md', content: 'hi', source: 'generated' });
    expect((await store.listBySession('s1')).length).toBe(2);
    await store.removeBySession('s1');
    expect((await store.listBySession('s1')).length).toBe(0);
    expect(store.blobFilePath(a.id, 1)).toBeNull();
  });

  it('imports legacy JSON artifacts once', async () => {
    const handle = openDb(':memory:');
    handle.raw.prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at, live_revision, list_message_count) VALUES (?, ?, ?, ?, 0, 0)',
    ).run('legacy-sess', 't', Date.now(), Date.now());
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'reizo-artifacts-legacy-'));
    mkdirSync(path.join(dataRoot, 'artifacts'), { recursive: true });
    writeFileSync(
      path.join(dataRoot, 'artifacts', 'old1.json'),
      JSON.stringify({
        id: 'old1',
        sessionId: 'legacy-sess',
        name: 'legacy.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        source: 'generated',
        createdAt: new Date().toISOString(),
        content: '# legacy',
      }),
    );
    const store = createArtifactStore(handle, dataRoot);
    const list = await store.listBySession('legacy-sess');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('legacy.md');
    // The source dir was renamed and a marker written.
    expect(existsSync(path.join(dataRoot, 'artifacts.legacy-imported'))).toBe(true);
    expect(readdirSync(dataRoot).some((f) => f.startsWith('artifacts.legacy-'))).toBe(true);

    // A second store on the same dataRoot must not double-import.
    const store2 = createArtifactStore(openDb(':memory:'), dataRoot);
    expect(await store2.listBySession('legacy-sess')).toHaveLength(0);
  });
});
