import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccountModelCredential } from '../../../shared/account';
import { generateText } from 'ai';
vi.mock('./providerStore', () => ({ safeEncrypt: (s: string) => `encrypted:${s}`, safeDecrypt: (s?: string) => s?.replace(/^encrypted:/, '') ?? null }));
import { createSettingsStore } from './settingsStore';
import { resolveSettingsModel } from '../providerResolver';
import { createOpenAiModel } from '../agent/provider/openai';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) { expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir())); await rm(folder, { recursive: true, force: true }); } });
const lease: AccountModelCredential = { organizationId: 'org-1', organizationName: 'Workspace', apiKey: 'sk-account', baseUrl: 'https://relay.example/v1', expiresAt: '2099-01-01T00:00:00Z', models: [{ id: 'chat-1', name: 'Chat' }] };

it('refreshes account media defaults from its public catalog without persisting credentials or metadata', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'reizo-account-settings-')); folders.push(folder);
  const current: AccountModelCredential = { ...lease, catalog: { text: [{ id: 'chat-1', name: 'Chat', protocol: 'openai' }], image: [{ id: 'nano-banana-2.1', name: 'Nano', protocol: 'openai-chat-image' }], video: [{ id: 'wan3.0-video', name: 'WAN', protocol: 'openai-video', video: { startFrame: false, endFrame: false, camera: false, reference: false } }] } };
  const store = createSettingsStore(folder, () => current);
  const result = await store.applyPatch({ activeProviderId: 'reizo-account', mediaModels: { video: 'obsolete-model' } });
  expect(result.mediaModels).toMatchObject({ image: 'nano-banana-2.1', video: 'wan3.0-video', draft: 'nano-banana-2.1' });
  expect(result.providers.find(p => p.id === 'reizo-account')?.catalog).toEqual(current.catalog);
  const raw = await readFile(path.join(folder, 'settings.json'), 'utf8');
  expect(raw).not.toContain('sk-account'); expect(raw).not.toContain('catalog');
  current.catalog = { text: current.catalog!.text, image: [], video: [] };
  expect((await store.getPublic()).mediaModels.video).toBeUndefined();
});

it('uses a login lease without a manual key and never persists or exposes it in settings', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'reizo-account-settings-')); folders.push(folder);
  let current: AccountModelCredential | null = lease;
  const store = createSettingsStore(folder, () => current);
  expect(resolveSettingsModel(await store.get(), { category: 'llm' })).toMatchObject({ providerId: 'reizo-account', modelId: 'chat-1', apiKey: 'sk-account' });
  const result = await store.applyPatch({ activeProviderId: 'reizo-account', appearance: 'dark' });
  expect(result.providers.find(p => p.id === 'reizo-account')).toMatchObject({ hasKey: true, models: lease.models });
  expect(JSON.stringify(result)).not.toContain('sk-account');
  expect(await readFile(path.join(folder, 'settings.json'), 'utf8')).not.toContain('sk-account');
  current = null;
  const settings = await store.get();
  expect(() => resolveSettingsModel(settings, { category: 'llm' })).toThrow('登录 Reizo');
  expect(() => resolveSettingsModel(settings, { category: 'image' })).toThrow('登录 Reizo');
});

it('keeps an explicitly configured third-party provider and manual Reizo keys intact', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'reizo-account-settings-')); folders.push(folder);
  let current: AccountModelCredential | null = lease;
  const store = createSettingsStore(folder, () => current);
  await store.applyPatch({ provider: { id: 'reizo', apiKey: 'sk-manual', model: 'manual-chat' }, activeProviderId: 'reizo' });
  expect(resolveSettingsModel(await store.get(), { category: 'llm' })).toMatchObject({ providerId: 'reizo', apiKey: 'sk-manual' });
  await store.applyPatch({ activeProviderId: 'reizo-account' });
  current = null;
  expect((await store.get()).providers.reizo.apiKey).toBe('sk-manual');
  await expect(store.applyPatch({ provider: { id: 'reizo-account', apiKey: 'sk-overwrite' } })).rejects.toThrow('登录管理');
});

it('sends a text request through the real provider transport using only the account lease', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'reizo-account-settings-')); folders.push(folder);
  const store = createSettingsStore(folder, () => lease);
  const resolved = resolveSettingsModel(await store.get(), { category: 'llm' });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe('https://relay.example/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-account');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'chat-1', messages: [{ role: 'user', content: 'hello' }] });
    return Response.json({ id: 'completion-test', object: 'chat.completion', created: 1, model: 'chat-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello from account' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 } });
  });
  const result = await generateText({ model: createOpenAiModel({ ...resolved, fetch: transport }), prompt: 'hello' });
  expect(result.text).toBe('hello from account');
  expect(transport).toHaveBeenCalledOnce();
});
