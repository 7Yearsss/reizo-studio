import * as api from '../api';
import type { PublicSettings, SettingsPatch } from '../../shared/settings';
import { DEFAULT_APPEARANCE, DEFAULT_PERMISSION_MODE, DEFAULT_PROVIDER_ID } from '../../shared/settings';

export interface SettingsState {
  loaded: boolean;
  settings: PublicSettings;
}

let state: SettingsState = {
  loaded: false,
  settings: {
    appearance: DEFAULT_APPEARANCE,
    permissionMode: DEFAULT_PERMISSION_MODE,
    activeProviderId: DEFAULT_PROVIDER_ID,
    workspacePath: null,
    providers: [],
  },
};

const listeners = new Set<() => void>();

function setState(patch: Partial<SettingsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SettingsState {
  return state;
}

export async function loadSettings(): Promise<PublicSettings> {
  const settings = await api.getSettings();
  setState({ settings, loaded: true });
  applyAppearance(settings.appearance);
  return settings;
}

export async function patchSettings(patch: SettingsPatch): Promise<PublicSettings> {
  const settings = await api.patchSettings(patch);
  setState({ settings, loaded: true });
  if (patch.appearance) applyAppearance(settings.appearance);
  return settings;
}

let media: MediaQueryList | null = null;

function systemIsDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyAppearance(appearance = state.settings.appearance): void {
  const dark = appearance === 'dark' || (appearance === 'system' && systemIsDark());
  document.documentElement.classList.toggle('dark', dark);

  if (!media) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      if (state.settings.appearance === 'system') applyAppearance('system');
    });
  }
}
