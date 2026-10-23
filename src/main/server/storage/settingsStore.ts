import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeDecrypt, safeEncrypt } from './providerStore';
import { PROVIDER_PRESETS } from '../../../shared/providers';
import type { AccountModelCredential } from '../../../shared/account';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_BUSY_ENTER,
  DEFAULT_COMPUTER_USE, DEFAULT_AUTO_APPLY_HARNESS_LESSONS,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PROVIDER_ID,
  DEFAULT_REASONING_EFFORT,
  type Appearance,
  type BusyEnterBehavior,
  type LocalSettings,
  type PermissionMode,
  type PublicProvider,
  type PublicSettings,
  type ReasoningEffort,
  type SettingsPatch,
  type StoredProvider,
} from '../../../shared/settings';

interface DiskSettings {
  appearance?: Appearance;
  permissionMode?: PermissionMode;
  busyEnter?: BusyEnterBehavior;
  computerUse?: boolean;
  autoApplyHarnessLessons?: boolean;
  mediaModels?: { image?: string; video?: string; draft?: string };
  directorSessions?: Record<string, boolean>;
  reasoningEffort?: ReasoningEffort | null;
  activeProviderId?: string;
  workspacePath?: string | null;
  providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
  /** Legacy single-key field; migrated into providers.openai on read. */
  openaiApiKey?: string;
}

function emptyStored(model: string, baseUrl?: string): StoredProvider {
  return { apiKey: null, model, baseUrl };
}

export function createSettingsStore(root: string, accountModels?: () => AccountModelCredential | null) {
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
        apiKey: safeDecrypt(saved?.apiKey),
        model: saved?.model || preset.defaultModel,
        baseUrl: saved?.baseUrl || undefined,
      };
    }

    if (disk.openaiApiKey && !providers.openai?.apiKey) {
      providers.openai = {
        ...(providers.openai ?? emptyStored('gpt-4o-mini')),
        apiKey: safeDecrypt(disk.openaiApiKey),
      };
      migrated = true;
    }

    const settings: LocalSettings = {
      appearance: disk.appearance ?? DEFAULT_APPEARANCE,
      permissionMode: disk.permissionMode ?? DEFAULT_PERMISSION_MODE,
      busyEnter: disk.busyEnter ?? DEFAULT_BUSY_ENTER,
      computerUse: disk.computerUse ?? DEFAULT_COMPUTER_USE,
      autoApplyHarnessLessons: disk.autoApplyHarnessLessons ?? DEFAULT_AUTO_APPLY_HARNESS_LESSONS,
      mediaModels: disk.mediaModels ?? {},
      directorSessions: disk.directorSessions ?? {},
      reasoningEffort: disk.reasoningEffort === undefined ? DEFAULT_REASONING_EFFORT : disk.reasoningEffort,
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
        apiKey: stored.apiKey ? safeEncrypt(stored.apiKey) : undefined,
      };
    }
    return {
      appearance: settings.appearance,
      permissionMode: settings.permissionMode,
      busyEnter: settings.busyEnter,
      computerUse: settings.computerUse,
      autoApplyHarnessLessons: settings.autoApplyHarnessLessons,
      mediaModels: settings.mediaModels,
      directorSessions: settings.directorSessions,
      reasoningEffort: settings.reasoningEffort,
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

  /** Merge at read time only: account secrets never enter settings.json or replace manual keys. */
  function withAccount(settings: LocalSettings): LocalSettings {
    const credential = accountModels?.();
    const selected = settings.providers[settings.activeProviderId];
    return {
      ...settings,
      activeProviderId: credential && !selected?.apiKey ? 'reizo-account' : settings.activeProviderId,
      providers: { ...settings.providers, 'reizo-account': {
        apiKey: credential?.apiKey ?? null,
        baseUrl: credential?.baseUrl,
        model: credential?.models.find(m => m.id === settings.providers['reizo-account']?.model)?.id ?? credential?.models[0]?.id ?? '',
      } },
    };
  }

  function toPublic(settings: LocalSettings): PublicSettings {
    const credential = accountModels?.();
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
        models: preset.id === 'reizo-account' ? credential?.models ?? [] : preset.models,
        baseUrl: stored.baseUrl || preset.baseUrl,
      };
    });
    return {
      appearance: settings.appearance,
      permissionMode: settings.permissionMode,
      busyEnter: settings.busyEnter,
      computerUse: settings.computerUse,
      autoApplyHarnessLessons: settings.autoApplyHarnessLessons,
      mediaModels: settings.mediaModels,
      directorSessions: settings.directorSessions,
      reasoningEffort: settings.reasoningEffort,
      activeProviderId: settings.activeProviderId,
      workspacePath: settings.workspacePath,
      providers,
    };
  }

  async function applyPatch(patch: SettingsPatch): Promise<PublicSettings> {
    const settings = await load();

    if (patch.appearance) settings.appearance = patch.appearance;
    if (patch.permissionMode) settings.permissionMode = patch.permissionMode;
    if (patch.busyEnter) settings.busyEnter = patch.busyEnter;
    if (patch.computerUse !== undefined) settings.computerUse = patch.computerUse;
    if (patch.autoApplyHarnessLessons !== undefined) settings.autoApplyHarnessLessons = patch.autoApplyHarnessLessons;
    if (patch.mediaModels) {
      settings.mediaModels = { ...settings.mediaModels, ...patch.mediaModels };
    }
    if (patch.reasoningEffort !== undefined) settings.reasoningEffort = patch.reasoningEffort;
    if (patch.directorSession) {
      const { sessionId, enabled } = patch.directorSession;
      settings.directorSessions = { ...settings.directorSessions, [sessionId]: enabled };
    }
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
      if (preset.id === 'reizo-account' && (patch.provider.apiKey !== undefined || patch.provider.baseUrl !== undefined)) {
        throw new Error('Reizo 账号凭据由登录管理，无需手动填写。');
      }
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
    return toPublic(withAccount(settings));
  }

  return {
    async get(): Promise<LocalSettings> {
      return withAccount(await load());
    },

    async getPublic(): Promise<PublicSettings> {
      return toPublic(withAccount(await load()));
    },

    applyPatch,

    async setOpenAiApiKey(key: string | null): Promise<void> {
      await applyPatch({ provider: { id: 'openai', apiKey: key } });
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
