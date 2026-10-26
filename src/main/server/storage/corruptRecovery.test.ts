import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProviderStore } from './providerStore';
import { createSettingsStore } from './settingsStore';

describe('corrupt JSON recovery', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'reizo-corrupt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('settings: starts from defaults and keeps the broken file aside', async () => {
    await writeFile(path.join(dir, 'settings.json'), '{ "oops": ', 'utf8');
    const store = createSettingsStore(dir);
    await expect(store.get()).resolves.toBeDefined();
    expect((await readdir(dir)).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true);
  });

  it('providers: starts from defaults and keeps the broken file aside', async () => {
    await writeFile(path.join(dir, 'providers-registry.json'), 'not json', 'utf8');
    const store = createProviderStore(dir);
    await expect(store.getAllManaged()).resolves.toBeDefined();
    expect((await readdir(dir)).some((f) => f.startsWith('providers-registry.json.corrupt-'))).toBe(true);
  });
});
