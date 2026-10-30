import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createSettingsStore } from './settingsStore';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'reizo-settings-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const disk = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8')) as Record<string, unknown>;

test('only the settings the user changed are written, so untouched ones keep following the defaults', async () => {
  const store = createSettingsStore(root);
  await store.applyPatch({ appearance: 'dark' });
  const saved = await disk();
  expect(saved.appearance).toBe('dark');
  for (const key of ['permissionMode', 'busyEnter', 'computerUse', 'agentStepLimit', 'autoApplyHarnessLessons', 'reasoningEffort', 'activeProviderId']) {
    expect(saved, key).not.toHaveProperty(key);
  }
  const read = await store.getPublic();
  expect(read.appearance).toBe('dark');
  expect(read.permissionMode).toBe('ask');
});

test('a value the user picked stays written even when it equals the default', async () => {
  const store = createSettingsStore(root);
  await store.applyPatch({ permissionMode: 'ask' });
  expect(await disk()).toHaveProperty('permissionMode', 'ask');
});

test('files written before this change keep every key they already have', async () => {
  await writeFile(path.join(root, 'settings.json'), JSON.stringify({ appearance: 'light', permissionMode: 'workspace', busyEnter: 'queue' }));
  const store = createSettingsStore(root);
  await store.applyPatch({ appearance: 'dark' });
  const saved = await disk();
  expect(saved).toMatchObject({ appearance: 'dark', permissionMode: 'workspace', busyEnter: 'queue' });
  expect(saved).not.toHaveProperty('computerUse');
});
