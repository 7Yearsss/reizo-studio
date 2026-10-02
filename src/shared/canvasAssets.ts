export type CanvasAssetKind = 'image' | 'video' | 'audio' | 'mask';
export type CanvasAssetSource = 'generated' | 'imported' | 'mask';

/** An immutable file identity and its origin; the path remains compatible with existing canvas outputs. */
export interface CanvasAsset {
  id: string;
  path: string;
  canvasId: string;
  nodeId?: string;
  kind: CanvasAssetKind;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  source: CanvasAssetSource;
  createdAt: string;
  jobId?: string;
  generation?: number;
  providerId?: string;
  model?: string;
  inputHash?: string;
}

/** Generated provenance is always read from the owning job, never accepted from a request. */
export interface CanvasAssetRegisterInput {
  id: string;
  path: string;
  canvasId: string;
  nodeId?: string;
  kind: CanvasAssetKind;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  source: CanvasAssetSource;
  jobId?: string;
}

/** Lightweight library projection; execution input snapshots stay in the detail record. */
export type CanvasAssetSummary = Omit<CanvasAsset, 'inputHash'> & { label: string };

export interface CanvasAssetReuseInput {
  assetId?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  assetIndex?: number;
  x?: number;
  y?: number;
  title?: string;
  asReference?: boolean;
}
