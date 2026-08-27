import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { PROVIDER_PRESETS } from '../../../shared/providers';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PROVIDER_ID,
  type Appearance,
  type LocalSettings,
  type PermissionMode,
  type PublicProvider,
  type PublicSettings,
  type SettingsPatch,
  type StoredProvider,
} from '../../../shared/settings';

interface DiskSettings {
  appearance?: Appearance;
  permissionMode?: PermissionMode;
  activeProviderId?: string;
  workspacePath?: string | null;
  providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
  /** Legacy single-key field; migrated into providers.openai on read. */
  openaiApiKey?: string;
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is unavailable; cannot store the API key securely.');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decrypt(encoded: string | undefined): string | null {
  if (!encoded) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return null;
  }
}

function emptyStored(model: string, baseUrl?: string): StoredProvider {
  return { apiKey: null, model, baseUrl };
}

export function createSettingsStore(root: string) {
  const file = path.join(root, 'settings.json');

  async function readRaw(): Promise<DiskSettings> {
    try {
      const raw = await readFile(file, 'utf8');
      return JSON.parse(raw) as DiskSettings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async function writeRaw(data: DiskSettings): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function hydrate(disk: DiskSettings): { settings: LocalSettings; migrated: boolean } {
    const providers: Record<string, StoredProvider> = {};
    let migrated = false;

    for (const preset of PROVIDER_PRESETS) {
      const saved = disk.providers?.[preset.id];
      providers[preset.id] = {
        apiKey: decrypt(saved?.apiKey),
        model: saved?.model || preset.defaultModel,
        baseUrl: saved?.baseUrl || undefined,
      };
    }

    if (disk.openaiApiKey && !providers.openai?.apiKey) {
      providers.openai = {
        ...(providers.openai ?? emptyStored('gpt-4o-mini')),
        apiKey: decrypt(disk.openaiApiKey),
      };
      migrated = true;
    }

    const settings: LocalSettings = {
      appearance: disk.appearance ?? DEFAULT_APPEARANCE,
      permissionMode: disk.permissionMode ?? DEFAULT_PERMISSION_MODE,
      activeProviderId: disk.activeProviderId ?? DEFAULT_PROVIDER_ID,
      workspacePath: disk.workspacePath ?? null,
      providers,
    };

    if (!PROVIDER_PRESETS.some((p) => p.id === settings.activeProviderId)) {
      settings.activeProviderId = DEFAULT_PROVIDER_ID;
    }

    return { settings, migrated };
  }

  function serialize(settings: LocalSettings): DiskSettings {
    const providers: DiskSettings['providers'] = {};
    for (const [id, stored] of Object.entries(settings.providers)) {
      providers[id] = {
        model: stored.model,
        baseUrl: stored.baseUrl,
        apiKey: stored.apiKey ? encrypt(stored.apiKey) : undefined,
      };
    }
    return {
      appearance: settings.appearance,
      permissionMode: settings.permissionMode,
      activeProviderId: settings.activeProviderId,
      workspacePath: settings.workspacePath,
      providers,
    };
  }

  async function load(): Promise<LocalSettings> {
    const disk = await readRaw();
    const { settings, migrated } = hydrate(disk);
    if (migrated) await writeRaw(serialize(settings));
    return settings;
  }

  function toPublic(settings: LocalSettings): PublicSettings {
    const providers: PublicProvider[] = PROVIDER_PRESETS.map((preset) => {
      const stored = settings.providers[preset.id] ?? emptyStored(preset.defaultModel);
      return {
        id: preset.id,
        name: preset.name,
        tag: preset.tag,
        websiteUrl: preset.websiteUrl,
        allowCustomBaseUrl: preset.allowCustomBaseUrl,
        description: preset.description,
        hasKey: Boolean(stored.apiKey),
        model: stored.model || preset.defaultModel,
        models: preset.models,
        baseUrl: stored.baseUrl || preset.baseUrl,
      };
    });
    return {
      appearance: settings.appearance,
      permissionMode: settings.permissionMode,
      activeProviderId: settings.activeProviderId,
      workspacePath: settings.workspacePath,
      providers,
    };
  }

  async function applyPatch(patch: SettingsPatch): Promise<PublicSettings> {
    const settings = await load();

    if (patch.appearance) settings.appearance = patch.appearance;
    if (patch.permissionMode) settings.permissionMode = patch.permissionMode;
    if (patch.activeProviderId) {
      if (!PROVIDER_PRESETS.some((p) => p.id === patch.activeProviderId)) {
        throw new Error('Unknown provider');
      }
      settings.activeProviderId = patch.activeProviderId;
    }
    if (patch.workspacePath !== undefined) {
      settings.workspacePath = patch.workspacePath;
    }
    if (patch.provider) {
      const preset = PROVIDER_PRESETS.find((p) => p.id === patch.provider!.id);
      if (!preset) throw new Error('Unknown provider');
      const current = settings.providers[preset.id] ?? emptyStored(preset.defaultModel);
      if (patch.provider.apiKey !== undefined) {
        current.apiKey = patch.provider.apiKey?.trim() ? patch.provider.apiKey.trim() : null;
      }
      if (patch.provider.model !== undefined) current.model = patch.provider.model;
      if (patch.provider.baseUrl !== undefined) {
        current.baseUrl = patch.provider.baseUrl?.trim() || undefined;
      }
      settings.providers[preset.id] = current;
      if (current.apiKey && !settings.providers[settings.activeProviderId]?.apiKey) {
        settings.activeProviderId = preset.id;
      }
    }

    await writeRaw(serialize(settings));
    return toPublic(settings);
  }

  return {
    async get(): Promise<LocalSettings> {
      return load();
    },

    async getPublic(): Promise<PublicSettings> {
      return toPublic(await load());
    },

    applyPatch,

    async setOpenAiApiKey(key: string | null): Promise<void> {
      await applyPatch({ provider: { id: 'openai', apiKey: key } });
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
