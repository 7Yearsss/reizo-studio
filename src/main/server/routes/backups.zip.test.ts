import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DbHandle } from '../db/client';
import { createBackupRouter } from './backups';

describe('backup zip routes', () => {
  let a: string;
  let b: string;
  let dbA: DbHandle;
  let dbB: DbHandle;
  beforeEach(async () => {
    a = await mkdtemp(path.join(os.tmpdir(), 'reizo-zroute-a-'));
    b = await mkdtemp(path.join(os.tmpdir(), 'reizo-zroute-b-'));
    dbA = openDb(path.join(a, 'reizo.db'));
    dbB = openDb(path.join(b, 'reizo.db'));
    await writeFile(path.join(a, 'settings.json'), '{"from":"machine-a"}');
  });
  afterEach(async () => {
    for (const db of [dbA, dbB]) { try { db.close(); } catch { /* closed */ } }
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  });

  it('exports a backup as one zip on machine A and imports it as a listed, restorable backup on machine B', async () => {
    const routerA = createBackupRouter({ dataRoot: a, db: dbA });
    const routerB = createBackupRouter({ dataRoot: b, db: dbB });

    const created = (await (await routerA.request('/', { method: 'POST' })).json()) as { backup: { name: string } };
    const exported = await routerA.request(`/${created.backup.name}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toBe('application/zip');
    expect(exported.headers.get('content-disposition')).toContain(`${created.backup.name}.zip`);
    const zip = Buffer.from(await exported.arrayBuffer());
    expect(zip.length).toBeGreaterThan(100);

    const imported = await routerB.request('/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
    expect(imported.status).toBe(201);
    const list = (await (await routerB.request('/')).json()) as { backups: Array<{ name: string }> };
    expect(list.backups.map((x) => x.name)).toContain(((await imported.json()) as { name: string }).name);

    const restore = await routerB.request(`/${list.backups[0].name}/restore`, { method: 'POST' });
    expect(restore.status).toBe(200);
  });

  it('rejects a body that is not a backup zip, and a path-like export name', async () => {
    const router = createBackupRouter({ dataRoot: b, db: dbB });
    const bad = await router.request('/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: Buffer.from('not a zip at all') });
    expect(bad.status).toBe(400);
    expect((await router.request('/..%2Fsecret/export')).status).toBeGreaterThanOrEqual(400);
  });
});
