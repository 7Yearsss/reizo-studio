import type { ProviderPreset } from './providers';

export type Appearance = 'system' | 'light' | 'dark';
export type PermissionMode = 'ask' | 'workspace' | 'full';
/** Plain Enter while the agent is busy: 'queue' parks it for the next turn, 'steer' injects it mid-turn. */
export type BusyEnterBehavior = 'queue' | 'steer';

export interface StoredProvider {
  apiKey: string | null;
  model: string;
  baseUrl?: string;
}

/** User-picked default generation models, chosen in the composer model picker
 * (image / video tabs). Consumed as the fallback when a canvas node or the
 * image tool doesn't pin its own model. */
export interface MediaModels {
  image?: string;
  video?: string;
}

export interface LocalSettings {
  appearance: Appearance;
  activeProviderId: string;
  workspacePath: string | null;
  permissionMode: PermissionMode;
  /** What plain Enter does while a turn is running: queue the message or steer it into the live turn. */
  busyEnter: BusyEnterBehavior;
  /** Let the agent drive the real mouse/keyboard/screen (the `computer` tool). Off by default. */
  computerUse: boolean;
  mediaModels: MediaModels;
  /** Per-session opt-in: agent may proactively use canvas tools instead of only on explicit request. */
  directorSessions: Record<string, boolean>;
  providers: Record<string, StoredProvider>;
}

export interface PublicProvider extends Pick<ProviderPreset, 'id' | 'name' | 'tag' | 'websiteUrl' | 'allowCustomBaseUrl' | 'description'> {
  hasKey: boolean;
  model: string;
  models: { id: string; name: string }[];
  baseUrl: string;
}

export interface PublicSettings {
  appearance: Appearance;
  activeProviderId: string;
  workspacePath: string | null;
  permissionMode: PermissionMode;
  busyEnter: BusyEnterBehavior;
  computerUse: boolean;
  mediaModels: MediaModels;
  directorSessions: Record<string, boolean>;
  providers: PublicProvider[];
}

export interface SettingsPatch {
  appearance?: Appearance;
  permissionMode?: PermissionMode;
  busyEnter?: BusyEnterBehavior;
  computerUse?: boolean;
  mediaModels?: MediaModels;
  directorSession?: { sessionId: string; enabled: boolean };
  activeProviderId?: string;
  workspacePath?: string | null;
  provider?: {
    id: string;
    apiKey?: string | null;
    model?: string;
    baseUrl?: string | null;
  };
}

export const DEFAULT_APPEARANCE: Appearance = 'system';
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'ask';
export const DEFAULT_BUSY_ENTER: BusyEnterBehavior = 'queue';
export const DEFAULT_COMPUTER_USE = false;
export const DEFAULT_PROVIDER_ID = 'openai';
