import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeMemoryEntry } from '../../workspaceMemoryDir';
import { personalMemoryRoot } from '../agent/personalMemory';
import type { MemoryEventsStore } from '../storage/memoryEventsStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createMemoryRouter } from './memory';

describe('memory management routes', () => {
  let dataRoot: string;
  let workspace: string;
  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-memroute-d-'));
    workspace = await mkdtemp(path.join(os.tmpdir(), 'reizo-memroute-w-'));
  });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); });
  const router = (ws: string | null) => createMemoryRouter({} as MemoryEventsStore, { get: async () => ({ workspacePath: ws }) } as unknown as SettingsStore, dataRoot);
  const put = (file: string, scope: string, body: unknown) => ({ path: `/entries/${file}?scope=${scope}`, init: { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } });

  it('lists personal and workspace memories separately, and reports a missing workspace', async () => {
    await writeMemoryEntry(personalMemoryRoot(dataRoot), { name: 'tone', description: 'd', type: 'user', body: '先结论' });
    await writeMemoryEntry(workspace, { name: 'brand', description: 'd', type: 'project', body: '主色' });
    const r = router(workspace);
    const personal = await (await r.request('/entries?scope=personal')).json() as { entries: Array<{ name: string }> };
    const ws = await (await r.request('/entries?scope=workspace')).json() as { entries: Array<{ name: string }> };
    expect(personal.entries.map((e) => e.name)).toEqual(['tone']);
    expect(ws.entries.map((e) => e.name)).toEqual(['brand']);
    expect(await (await router(null).request('/entries?scope=workspace')).json()).toMatchObject({ available: false, entries: [] });
  });

  it('edits text and privacy in place, refuses secrets, deletes one and clears all', async () => {
    const root = personalMemoryRoot(dataRoot);
    const { fileName } = await writeMemoryEntry(root, { name: 'tone', description: 'd', type: 'user', body: 'old' });
    await writeMemoryEntry(root, { name: 'other', description: 'd', type: 'user', body: 'x' });
    const r = router(null);
    const edit = put(fileName, 'personal', { body: '新内容', private: true });
    const edited = await (await r.request(edit.path, edit.init)).json() as { entry: { body: string; private?: boolean; name: string } };
    expect(edited.entry).toMatchObject({ body: '新内容', private: true, name: 'tone' });
    const bad = put(fileName, 'personal', { body: 'sk-' + 'a'.repeat(30) });
    expect((await r.request(bad.path, bad.init)).status).toBe(400);
    expect((await r.request(`/${fileName}?scope=personal`, { method: 'DELETE' })).status).toBe(200);
    expect((await (await r.request('/entries?scope=personal')).json() as { entries: unknown[] }).entries).toHaveLength(1);
    expect(await (await r.request('/?scope=personal', { method: 'DELETE' })).json()).toMatchObject({ removed: 1 });
    expect((await (await r.request('/entries?scope=personal')).json() as { entries: unknown[] }).entries).toHaveLength(0);
  });
});
