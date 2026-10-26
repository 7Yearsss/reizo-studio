import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from './projectStore';

describe('project defaults, pin and archive', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-project-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('stores and clears the default skill and model', async () => {
    const store = createProjectStore(root);
    const p = await store.create({ name: 'p' });
    const set = await store.update(p.id, { defaultSkillId: 'social-pack', defaultModel: { providerId: 'x', model: ' gpt-5 ' } });
    expect(set.defaultSkillId).toBe('social-pack');
    expect(set.defaultModel).toEqual({ providerId: 'x', model: 'gpt-5' });
    const cleared = await store.update(p.id, { defaultSkillId: null, defaultModel: null });
    expect(cleared.defaultSkillId).toBeUndefined();
    expect(cleared.defaultModel).toBeUndefined();
  });

  it('archives and restores without losing anything, and pins', async () => {
    const store = createProjectStore(root);
    const p = await store.create({ name: 'keep', instructions: 'rules' });
    const archived = await store.update(p.id, { archived: true, pinned: true });
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.pinned).toBe(true);
    expect(archived.instructions).toBe('rules');
    const again = await store.update(p.id, { archived: true });
    expect(again.archivedAt).toBe(archived.archivedAt); // archiving twice keeps the first time
    const restored = await store.update(p.id, { archived: false, pinned: false });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.pinned).toBeUndefined();
    expect((await store.get(p.id))?.name).toBe('keep');
  });
});
