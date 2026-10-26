import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsRouter } from '../routes/settings';
import type { SettingsStore } from './settingsStore';
import { createWebSearchStore } from './webSearchStore';

describe('web search config', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-search-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('stores the key encrypted-or-masked on disk, keeps it when omitted, clears it on empty', async () => {
    const store = createWebSearchStore(root);
    await store.save({ provider: 'brave', apiKey: 'secret-key-123' });
    expect(await readFile(path.join(root, 'web-search.json'), 'utf8')).not.toContain('secret-key-123');
    expect((await store.get())?.apiKey).toBe('secret-key-123');
    await store.save({ provider: 'brave' });
    expect((await store.get())?.apiKey).toBe('secret-key-123');
    await store.save({ provider: 'brave', apiKey: '' });
    expect((await store.get())?.apiKey).toBeUndefined();
  });

  it('the route never returns the key and rejects unknown providers', async () => {
    const store = createWebSearchStore(root);
    const router = createSettingsRouter({} as SettingsStore, root, store);
    const put = (body: unknown) => router.request('/web-search', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put({ provider: 'tavily', apiKey: 'tvly-abc' })).status).toBe(200);
    const read = await (await router.request('/web-search')).json() as Record<string, unknown>;
    expect(read).toEqual({ provider: 'tavily', baseUrl: '', hasKey: true });
    expect((await put({ provider: 'nope' })).status).toBe(400);
  });
});
