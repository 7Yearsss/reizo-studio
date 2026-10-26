import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SEARCH_PROVIDERS, type SearchProvider, type WebSearchConfig } from '../../../shared/webSearch';
import { writeTextAtomic } from './atomicFile';
import { safeDecrypt, safeEncrypt } from './providerStore';

interface Disk { provider?: SearchProvider; baseUrl?: string; apiKey?: string }

/** Which search service to use and its key (encrypted at rest). The key never leaves this store except to the search request itself. */
export function createWebSearchStore(root: string) {
  const file = path.join(root, 'web-search.json');
  async function read(): Promise<Disk> {
    try { return JSON.parse(await readFile(file, 'utf8')) as Disk; } catch { return {}; }
  }
  return {
    async get(): Promise<WebSearchConfig | null> {
      const disk = await read();
      if (!disk.provider || !SEARCH_PROVIDERS.some((p) => p.id === disk.provider)) return null;
      return { provider: disk.provider, ...(disk.baseUrl ? { baseUrl: disk.baseUrl } : {}), ...(disk.apiKey ? { apiKey: safeDecrypt(disk.apiKey) ?? undefined } : {}) };
    },
    /** `apiKey: undefined` keeps the stored key; an empty string clears it. */
    async save(input: { provider: SearchProvider; baseUrl?: string; apiKey?: string }): Promise<void> {
      if (!SEARCH_PROVIDERS.some((p) => p.id === input.provider)) throw new Error('搜索服务无效');
      const previous = await read();
      const apiKey = input.apiKey === undefined ? previous.apiKey : input.apiKey.trim() ? safeEncrypt(input.apiKey.trim()) : undefined;
      await writeTextAtomic(file, JSON.stringify({ provider: input.provider, baseUrl: input.baseUrl?.trim() || undefined, apiKey }, null, 2));
    },
  };
}
export type WebSearchStore = ReturnType<typeof createWebSearchStore>;
