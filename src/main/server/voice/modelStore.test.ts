import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceModelStore } from './modelStore';
import { VOICE_MODEL } from '../../../shared/voiceInput';

const roots: string[] = [];
const bytes = Buffer.from('verified model');
const files = [['config.json', bytes.length, createHash('sha256').update(bytes).digest('hex')]] as const;
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), 'reizo-voice-')); roots.push(dir); return dir; }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('downloads once, verifies bytes, persists across restart and restricts file access', async () => {
  const dir = await root(), fetcher = vi.fn(async () => new Response(bytes));
  const store = createVoiceModelStore(dir, fetcher, undefined, files);
  await Promise.all([store.prepare(), store.prepare()]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect((await store.status()).ready).toBe(true);
  const restarted = createVoiceModelStore(dir, fetcher, undefined, files);
  expect((await restarted.status()).ready).toBe(true);
  expect(await restarted.read('config.json')).toEqual(bytes);
  expect(await restarted.read('../config.json')).toBeNull();
});
it('never marks corrupt downloads ready and allows retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('bad')).mockResolvedValueOnce(new Response(bytes));
  const store = createVoiceModelStore(await root(), fetcher, undefined, files);
  await expect(store.prepare()).rejects.toThrow('校验');
  expect((await store.status()).ready).toBe(false);
  expect(await store.read('config.json')).toBeNull();
  await store.prepare(); expect((await store.status()).ready).toBe(true);
});
it('reuses only a hash-verified local seed without a network request', async () => {
  const seed = await root(); await mkdir(path.join(seed, VOICE_MODEL), { recursive: true });
  await writeFile(path.join(seed, VOICE_MODEL, 'config.json'), bytes);
  const fetcher = vi.fn();
  const store = createVoiceModelStore(await root(), fetcher, seed, files);
  await store.prepare(); expect(fetcher).not.toHaveBeenCalled(); expect((await store.status()).ready).toBe(true);
});
