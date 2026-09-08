import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadProviderCatalog,
  getSnapshot,
} from './providerCatalogStore';
import * as api from '../api';

vi.mock('../api', () => ({
  getPublicProviderCatalog: vi.fn(),
}));

describe('providerCatalogStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads provider catalog and populates snapshot', async () => {
    vi.mocked(api.getPublicProviderCatalog).mockResolvedValueOnce({
      providers: [
        {
          id: 'audio-1',
          name: 'MiniMax Audio',
          category: 'audio',
          driverType: 'minimax',
          hasKey: true,
          sampleParams: {},
          availableModels: [],
          voicePresets: [],
          enabled: true,
          isDefault: true,
        },
      ],
      defaultProviderByCategory: { audio: 'audio-1' },
    });

    await loadProviderCatalog(true);
    const snap = getSnapshot();

    expect(snap.loaded).toBe(true);
    expect(snap.catalog.providers.length).toBe(1);
    expect(snap.catalog.providers[0].id).toBe('audio-1');
    expect(snap.catalog.defaultProviderByCategory.audio).toBe('audio-1');
  });
});
