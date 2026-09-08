import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  DEFAULT_PROVIDER_TEMPLATES,
  type ManagedProviderConfig,
  type ProviderCatalogResponse,
  type ProviderCategory,
  type PublicProviderCatalogItem,
} from '../../../shared/providerRegistry';

export const DEFAULT_ADMIN_PASSKEY = 'admin888';

interface StoredDiskConfig {
  providers: Record<
    string,
    Omit<ManagedProviderConfig, 'credentials'> & {
      credentials: {
        apiKeyEncrypted?: string;
        baseUrl?: string;
        appId?: string;
        groupId?: string;
      };
    }
  >;
  adminPasskey?: string;
  deletedIds?: string[];
}

function safeEncrypt(value: string): string {
  try {
    if (typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    /* fallback to base64 envelope for testing environments */
  }
  return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
}

function safeDecrypt(encoded: string | undefined): string | null {
  if (!encoded) return null;
  if (encoded.startsWith('b64:')) {
    return Buffer.from(encoded.slice(4), 'base64').toString('utf8');
  }
  try {
    if (typeof safeStorage !== 'undefined') {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    }
  } catch {
    return null;
  }
  return null;
}

export function maskApiKey(key?: string | null): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

export function createProviderStore(root: string) {
  const file = path.join(root, 'providers-registry.json');

  async function readRaw(): Promise<StoredDiskConfig> {
    try {
      const raw = await readFile(file, 'utf8');
      return JSON.parse(raw) as StoredDiskConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { providers: {}, deletedIds: [] };
      }
      throw err;
    }
  }

  async function writeRaw(data: StoredDiskConfig): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  async function initDefaultsIfNeeded(): Promise<Record<string, ManagedProviderConfig>> {
    const raw = await readRaw();
    const providers: Record<string, ManagedProviderConfig> = {};
    const deletedSet = new Set(raw.deletedIds ?? []);

    let needsWrite = false;
    const now = new Date().toISOString();

    // Rehydrate saved
    for (const [id, item] of Object.entries(raw.providers || {})) {
      providers[id] = {
        ...item,
        credentials: {
          apiKey: item.credentials?.apiKeyEncrypted ? safeDecrypt(item.credentials.apiKeyEncrypted) ?? '' : '',
          baseUrl: item.credentials?.baseUrl,
          appId: item.credentials?.appId,
          groupId: item.credentials?.groupId,
        },
      };
    }

    // Seed defaults for any missing template that hasn't been explicitly deleted
    for (const template of DEFAULT_PROVIDER_TEMPLATES) {
      if (!providers[template.id] && !deletedSet.has(template.id)) {
        providers[template.id] = {
          ...template,
          createdAt: now,
          updatedAt: now,
        };
        needsWrite = true;
      }
    }

    if (needsWrite || Object.keys(raw.providers || {}).length === 0) {
      await saveAll(providers, raw.adminPasskey, Array.from(deletedSet));
    }

    return providers;
  }

  async function saveAll(
    providers: Record<string, ManagedProviderConfig>,
    adminPasskey?: string,
    deletedIds?: string[],
  ): Promise<void> {
    const disk: StoredDiskConfig = {
      adminPasskey,
      deletedIds,
      providers: {},
    };

    for (const [id, config] of Object.entries(providers)) {
      disk.providers[id] = {
        ...config,
        credentials: {
          apiKeyEncrypted: config.credentials.apiKey ? safeEncrypt(config.credentials.apiKey) : undefined,
          baseUrl: config.credentials.baseUrl,
          appId: config.credentials.appId,
          groupId: config.credentials.groupId,
        },
      };
    }

    await writeRaw(disk);
  }

  return {
    async verifyAdminPasskey(candidate: string): Promise<boolean> {
      const raw = await readRaw();
      const currentPasskey = process.env.REIZO_ADMIN_PASSKEY || raw.adminPasskey || DEFAULT_ADMIN_PASSKEY;
      return candidate.trim() === currentPasskey;
    },

    async setAdminPasskey(newPasskey: string): Promise<void> {
      const raw = await readRaw();
      raw.adminPasskey = newPasskey.trim();
      await writeRaw(raw);
    },

    /** Admin: List all providers with MASKED API keys. */
    async getAllManaged(): Promise<ManagedProviderConfig[]> {
      const providers = await initDefaultsIfNeeded();
      return Object.values(providers).map((p) => ({
        ...p,
        credentials: {
          ...p.credentials,
          apiKey: maskApiKey(p.credentials.apiKey),
        },
      }));
    },

    /** Internal Executor only: Retrieve provider configuration with UNMASKED secret. */
    async getByIdWithSecret(id: string): Promise<ManagedProviderConfig | null> {
      const providers = await initDefaultsIfNeeded();
      return providers[id] ?? null;
    },

    /** Public catalog for user canvas: zero credentials leakage. */
    async getPublicCatalog(categoryFilter?: ProviderCategory): Promise<ProviderCatalogResponse> {
      const providers = await initDefaultsIfNeeded();
      const list = Object.values(providers).filter((p) => p.enabled);

      const filtered = categoryFilter ? list.filter((p) => p.category === categoryFilter) : list;

      const publicItems: PublicProviderCatalogItem[] = filtered.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        driverType: p.driverType,
        description: p.description,
        hasKey: Boolean(p.credentials.apiKey && p.credentials.apiKey.trim().length > 0),
        sampleParams: p.sampleParams ?? {},
        availableModels: p.availableModels ?? [],
        voicePresets: p.voicePresets ?? [],
        enabled: p.enabled,
        isDefault: p.isDefault,
      }));

      const defaultProviderByCategory: Partial<Record<ProviderCategory, string>> = {};
      for (const item of list) {
        if (item.isDefault && (!defaultProviderByCategory[item.category] || item.isDefault)) {
          defaultProviderByCategory[item.category] = item.id;
        }
      }

      return {
        providers: publicItems,
        defaultProviderByCategory,
      };
    },

    /** Admin: Upsert provider config. If apiKey is masked (contains '****'), existing key is preserved. */
    async upsert(config: Partial<ManagedProviderConfig> & {
      id: string;
      name: string;
      category: ProviderCategory;
      driverType: string;
    }): Promise<ManagedProviderConfig> {
      const providers = await initDefaultsIfNeeded();
      const raw = await readRaw();
      const existing = providers[config.id];
      const now = new Date().toISOString();

      let resolvedApiKey = config.credentials?.apiKey;
      if (resolvedApiKey && resolvedApiKey.includes('****') && existing) {
        resolvedApiKey = existing.credentials.apiKey;
      }

      // If re-adding an id that was deleted, remove from deletedIds
      const deletedSet = new Set(raw.deletedIds ?? []);
      deletedSet.delete(config.id);

      // If marked as default, unset other defaults in the same category
      if (config.isDefault) {
        for (const p of Object.values(providers)) {
          if (p.category === config.category && p.id !== config.id) {
            p.isDefault = false;
          }
        }
      }

      const updated: ManagedProviderConfig = {
        id: config.id,
        name: config.name,
        category: config.category,
        driverType: config.driverType,
        description: config.description ?? existing?.description,
        credentials: {
          apiKey: resolvedApiKey ?? existing?.credentials.apiKey ?? '',
          baseUrl: config.credentials?.baseUrl ?? existing?.credentials.baseUrl,
          appId: config.credentials?.appId ?? existing?.credentials.appId,
          groupId: config.credentials?.groupId ?? existing?.credentials.groupId,
        },
        sampleParams: config.sampleParams ?? existing?.sampleParams ?? {},
        availableModels: config.availableModels ?? existing?.availableModels ?? [],
        voicePresets: config.voicePresets ?? existing?.voicePresets ?? [],
        enabled: config.enabled ?? existing?.enabled ?? true,
        isDefault: config.isDefault ?? existing?.isDefault ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      providers[config.id] = updated;
      await saveAll(providers, raw.adminPasskey, Array.from(deletedSet));

      return {
        ...updated,
        credentials: {
          ...updated.credentials,
          apiKey: maskApiKey(updated.credentials.apiKey),
        },
      };
    },

    /** Admin: Delete provider by id. */
    async delete(id: string): Promise<boolean> {
      const providers = await initDefaultsIfNeeded();
      if (!providers[id]) return false;
      delete providers[id];

      const raw = await readRaw();
      const deletedSet = new Set(raw.deletedIds ?? []);
      deletedSet.add(id);

      await saveAll(providers, raw.adminPasskey, Array.from(deletedSet));
      return true;
    },

    /** Admin: Set default provider for a category. */
    async setDefault(category: ProviderCategory, id: string): Promise<void> {
      const providers = await initDefaultsIfNeeded();
      if (!providers[id]) throw new Error(`Provider ${id} not found`);

      for (const p of Object.values(providers)) {
        if (p.category === category) {
          p.isDefault = p.id === id;
        }
      }

      const raw = await readRaw();
      await saveAll(providers, raw.adminPasskey, raw.deletedIds);
    },
  };
}

export type ProviderStore = ReturnType<typeof createProviderStore>;
