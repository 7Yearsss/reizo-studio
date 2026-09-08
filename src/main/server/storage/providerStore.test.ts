import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProviderStore, maskApiKey } from './providerStore';

describe('providerStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'reizo-provider-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('masks API keys correctly', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('1234567')).toBe('********');
    expect(maskApiKey('sk-ant-api03-abcdefg1234')).toBe('sk-****1234');
  });

  it('seeds default provider templates on first load', async () => {
    const store = createProviderStore(tmpDir);
    const managed = await store.getAllManaged();

    expect(managed.length).toBeGreaterThanOrEqual(4);
    const minimax = managed.find((p) => p.id === 'minimax-audio-default');
    expect(minimax).toBeDefined();
    expect(minimax?.category).toBe('audio');
    expect(minimax?.driverType).toBe('minimax');
    expect(minimax?.sampleParams.model).toBe('speech-01-turbo');
  });

  it('strictly hides credentials from getPublicCatalog', async () => {
    const store = createProviderStore(tmpDir);

    // Save a secret key into minimax
    await store.upsert({
      id: 'minimax-audio-default',
      name: 'MiniMax 语音',
      category: 'audio',
      driverType: 'minimax',
      credentials: { apiKey: 'sk-minimax-secret-token-999', groupId: 'group_123' },
    });

    const catalog = await store.getPublicCatalog('audio');
    const minimaxPublic = catalog.providers.find((p) => p.id === 'minimax-audio-default');

    expect(minimaxPublic).toBeDefined();
    expect(minimaxPublic?.hasKey).toBe(true);
    // Credentials field must NOT exist on public catalog item!
    expect((minimaxPublic as any).credentials).toBeUndefined();

    // Internal fetch retrieves unmasked key
    const internal = await store.getByIdWithSecret('minimax-audio-default');
    expect(internal?.credentials.apiKey).toBe('sk-minimax-secret-token-999');
    expect(internal?.credentials.groupId).toBe('group_123');

    // Managed list retrieves masked key
    const managedList = await store.getAllManaged();
    const minimaxManaged = managedList.find((p) => p.id === 'minimax-audio-default');
    expect(minimaxManaged?.credentials.apiKey).toBe('sk-****-999');
  });

  it('verifies admin passkey and allows updating it', async () => {
    const store = createProviderStore(tmpDir);

    expect(await store.verifyAdminPasskey('admin888')).toBe(true);
    expect(await store.verifyAdminPasskey('wrongpass')).toBe(false);

    await store.setAdminPasskey('newsecret999');
    expect(await store.verifyAdminPasskey('newsecret999')).toBe(true);
    expect(await store.verifyAdminPasskey('admin888')).toBe(false);
  });

  it('supports setDefault and delete', async () => {
    const store = createProviderStore(tmpDir);

    await store.setDefault('audio', 'cosyvoice-audio-default');
    const catalog = await store.getPublicCatalog('audio');
    expect(catalog.defaultProviderByCategory.audio).toBe('cosyvoice-audio-default');

    const deleted = await store.delete('mock-audio-local');
    expect(deleted).toBe(true);
    const managed = await store.getAllManaged();
    expect(managed.some((p) => p.id === 'mock-audio-local')).toBe(false);
  });
});
