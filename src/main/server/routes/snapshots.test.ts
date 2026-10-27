import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileSnapshotStore } from '../storage/fileSnapshots';
import { createSnapshotsRouter } from './snapshots';
import { writeWorkspaceFile } from '../../workspaceWrite';

describe('rollback of an agent write', () => {
  let data: string;
  let ws: string;
  beforeEach(async () => { data = await mkdtemp(path.join(os.tmpdir(), 'reizo-snap-d-')); ws = await mkdtemp(path.join(os.tmpdir(), 'reizo-snap-w-')); });
  afterEach(async () => { await rm(data, { recursive: true, force: true }); await rm(ws, { recursive: true, force: true }); });

  const setup = () => {
    const snapshots = createFileSnapshotStore(data);
    return { snapshots, router: createSnapshotsRouter({ snapshots, getWorkspace: async () => ws }) };
  };
  const rollback = (router: ReturnType<typeof setup>['router'], sid: string, id: string, force = false) =>
    router.request(`/${sid}/snapshots/${id}/rollback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });

  it('puts an overwritten file back exactly, and removes a file the agent created', async () => {
    const { snapshots, router } = setup();
    await writeFile(path.join(ws, 'a.md'), 'original');
    await writeWorkspaceFile(ws, 'a.md', 'agent version');
    const id = await snapshots.save({ sessionId: 's1', path: 'a.md', existed: true, before: 'original', after: 'agent version' });
    expect((await rollback(router, 's1', id)).status).toBe(200);
    expect(await readFile(path.join(ws, 'a.md'), 'utf8')).toBe('original');

    await writeWorkspaceFile(ws, 'new.md', 'created by agent');
    const created = await snapshots.save({ sessionId: 's1', path: 'new.md', existed: false, before: '', after: 'created by agent' });
    const res = await rollback(router, 's1', created);
    expect(((await res.json()) as { restored: string }).restored).toBe('deleted');
    await expect(stat(path.join(ws, 'new.md'))).rejects.toBeTruthy();
  });

  it('asks before discarding later changes, and does so only with force', async () => {
    const { snapshots, router } = setup();
    await writeFile(path.join(ws, 'b.md'), 'v1');
    await writeWorkspaceFile(ws, 'b.md', 'agent');
    const id = await snapshots.save({ sessionId: 's1', path: 'b.md', existed: true, before: 'v1', after: 'agent' });
    await writeFile(path.join(ws, 'b.md'), 'my own edit after the agent');
    const blocked = await rollback(router, 's1', id);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code: string }).code).toBe('changed');
    expect(await readFile(path.join(ws, 'b.md'), 'utf8')).toBe('my own edit after the agent');
    expect((await rollback(router, 's1', id, true)).status).toBe(200);
    expect(await readFile(path.join(ws, 'b.md'), 'utf8')).toBe('v1');
  });

  it('unknown snapshot, another session\'s snapshot and a path-like id are all refused', async () => {
    const { snapshots, router } = setup();
    const id = await snapshots.save({ sessionId: 's1', path: 'c.md', existed: false, before: '', after: 'x' });
    expect((await rollback(router, 's1', 'nope')).status).toBe(404);
    expect((await rollback(router, 'other', id)).status).toBe(404);
    expect((await rollback(router, 's1', '..%2F..%2Fx')).status).toBe(404);
  });
});
