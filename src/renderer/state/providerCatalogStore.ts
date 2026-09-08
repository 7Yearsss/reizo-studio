import { useMemo, useSyncExternalStore } from 'react';
import * as api from '../api';
import type {
  ProviderCatalogResponse,
  ProviderCategory,
  PublicProviderCatalogItem,
} from '../../shared/providerRegistry';

export interface ProviderCatalogState {
  loaded: boolean;
  loading: boolean;
  catalog: ProviderCatalogResponse;
  error: string | null;
}

const DEFAULT_STATE: ProviderCatalogState = {
  loaded: false,
  loading: false,
  catalog: {
    providers: [],
    defaultProviderByCategory: {},
  },
  error: null,
};

let state: ProviderCatalogState = { ...DEFAULT_STATE };
const listeners = new Set<() => void>();

function setState(patch: Partial<ProviderCatalogState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ProviderCatalogState {
  return state;
}

export function useProviderCatalog<T>(selector: (state: ProviderCatalogState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}

export async function loadProviderCatalog(force = false): Promise<ProviderCatalogResponse> {
  if (state.loading) return state.catalog;
  if (state.loaded && !force) return state.catalog;

  setState({ loading: true, error: null });
  try {
    const catalog = await api.getPublicProviderCatalog();
    setState({ catalog, loaded: true, loading: false });
    return catalog;
  } catch (err: any) {
    const errorMsg = err?.message || '获取服务商目录失败';
    setState({ error: errorMsg, loading: false });
    return state.catalog;
  }
}

export function useProvidersByCategory(category: ProviderCategory): PublicProviderCatalogItem[] {
  const allProviders = useProviderCatalog((s) => s.catalog.providers);
  return useMemo(
    () => allProviders.filter((p) => p.category === category),
    [allProviders, category],
  );
}

export function useDefaultProviderId(category: ProviderCategory): string | undefined {
  return useProviderCatalog((s) => s.catalog.defaultProviderByCategory[category]);
}
