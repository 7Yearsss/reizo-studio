export type ModelKind = 'text' | 'image' | 'video';
export type ModelProtocol = 'openai' | 'openai-image' | 'openai-chat-image' | 'openai-video';
export interface VideoModelSupport {
  startFrame: boolean;
  endFrame: boolean;
  camera: boolean;
  reference: boolean;
  fields?: string[];
  minSeconds?: number;
  maxSeconds?: number;
  aspectRatios?: string[];
  encoding?: 'json' | 'multipart';
  profileId?: string;
}
export interface CatalogModel { id: string; name: string; protocol: ModelProtocol; video?: VideoModelSupport }
export interface ModelCatalog { text: CatalogModel[]; image: CatalogModel[]; video: CatalogModel[] }

/** Whitelist public metadata at the account boundary; credentials never enter this catalog. */
export function parseModelCatalog(value: unknown): ModelCatalog | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Invalid model catalog');
  const source = value as Record<string, unknown>;
  const result: ModelCatalog = { text: [], image: [], video: [] };
  for (const kind of ['text', 'image', 'video'] as const) {
    const entries = source[kind];
    if (!Array.isArray(entries) || entries.length > 10000) throw new Error('Invalid model catalog');
    result[kind] = entries.map((item): CatalogModel => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' ||
        !(['openai', 'openai-image', 'openai-chat-image', 'openai-video'] as unknown[]).includes(item.protocol)) throw new Error('Invalid model catalog entry');
      const entry: CatalogModel = { id: item.id, name: item.name, protocol: item.protocol };
      if (kind === 'text' && item.protocol !== 'openai' || kind === 'image' && !['openai-image', 'openai-chat-image'].includes(item.protocol) || kind === 'video' && item.protocol !== 'openai-video') throw new Error('Invalid model protocol');
      if (kind === 'video') {
        const support = item.video;
        if (!support || ['startFrame', 'endFrame', 'camera', 'reference'].some(key => typeof support[key] !== 'boolean')) throw new Error('Invalid video capabilities');
        entry.video = { startFrame: support.startFrame, endFrame: support.endFrame, camera: support.camera, reference: support.reference };
        for (const key of ['minSeconds', 'maxSeconds'] as const) if (support[key] !== undefined) {
          if (!Number.isInteger(support[key]) || support[key] < 1 || support[key] > 3600) throw new Error('Invalid video duration');
          entry.video[key] = support[key];
        }
        if (entry.video.minSeconds && entry.video.maxSeconds && entry.video.minSeconds > entry.video.maxSeconds) throw new Error('Invalid video duration range');
        for (const key of ['fields', 'aspectRatios'] as const) if (support[key] !== undefined) {
          if (!Array.isArray(support[key]) || support[key].some((value: unknown) => typeof value !== 'string')) throw new Error('Invalid video fields');
          entry.video[key] = [...support[key]];
        }
        if (support.encoding === 'json' || support.encoding === 'multipart') entry.video.encoding = support.encoding;
        if (typeof support.profileId === 'string') entry.video.profileId = support.profileId;
      }
      return entry;
    });
  }
  return result;
}
