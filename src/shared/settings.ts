import type { ProviderPreset } from './providers';

export type Appearance = 'system' | 'light' | 'dark';
export type PermissionMode = 'ask' | 'workspace' | 'full';

export interface StoredProvider {
  apiKey: string | null;
  model: string;
  baseUrl?: string;
}

export interface LocalSettings {
  appearance: Appearance;
  activeProviderId: string;
  workspacePath: string | null;
  permissionMode: PermissionMode;
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
  providers: PublicProvider[];
}

export interface SettingsPatch {
  appearance?: Appearance;
  permissionMode?: PermissionMode;
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
export const DEFAULT_PROVIDER_ID = 'openai';
