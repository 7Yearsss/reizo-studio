import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExpertsRouter } from '../routes/experts';
import { createExpertStore, ExpertValidationError } from './expertStore';

describe('expert store and routes', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-experts-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const base = { aliases: [] as string[], description: '', instructions: '你是资深文案' };

  it('saves, lists, reads and removes an expert', async () => {
    const store = createExpertStore(root);
    const saved = await store.save({ ...base, name: '文案专家', aliases: ['copywriter'], model: 'gpt-5', allowedTools: 'read_file', maxTurns: 10 });
    expect(saved.id).toBe('文案专家');
    expect((await store.list()).map((e) => e.name)).toEqual(['文案专家']);
    expect(await store.get(saved.id)).toMatchObject({ model: 'gpt-5', aliases: ['copywriter'], maxTurns: 10 });
    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.remove(saved.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('rejects bad names, empty instructions and handle clashes', async () => {
    const store = createExpertStore(root);
    await expect(store.save({ ...base, name: 'has space' })).rejects.toBeInstanceOf(ExpertValidationError);
    await expect(store.save({ ...base, name: '@x' })).rejects.toBeInstanceOf(ExpertValidationError);
    await expect(store.save({ ...base, name: 'ok', instructions: '   ' })).rejects.toBeInstanceOf(ExpertValidationError);
    await store.save({ ...base, name: '文案专家', aliases: ['writer'] });
    await expect(store.save({ ...base, name: '写手', aliases: ['Writer'] })).rejects.toThrow('冲突');
  });

  it('masks secrets in instructions and refuses path-like ids', async () => {
    const store = createExpertStore(root);
    const saved = await store.save({ ...base, name: 'k', instructions: 'use key sk-' + 'a'.repeat(30) });
    expect(saved.instructions).not.toContain('a'.repeat(30));
    expect(await store.get('../etc/passwd')).toBeNull();
  });

  it('the router validates and returns 400 with the reason', async () => {
    const router = createExpertsRouter(createExpertStore(root));
    const put = (body: unknown) => router.request('/', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bad = await put({ name: 'x y', instructions: 'i' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('名称');
    const ok = await put({ name: '专家', instructions: 'i' });
    expect(ok.status).toBe(200);
    expect(((await (await router.request('/')).json()) as { experts: unknown[] }).experts).toHaveLength(1);
    expect((await router.request('/nope', { method: 'DELETE' })).status).toBe(404);
  });
});
