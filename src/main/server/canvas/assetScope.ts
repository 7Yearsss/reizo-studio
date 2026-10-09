import type { CanvasAsset } from '../../../shared/canvasAssets';
import type { CanvasStore } from '../storage/canvasStore';

/** Cross-canvas library versions are available only after explicit reuse in this canvas. */
export function assetAvailableInCanvas(store: CanvasStore, canvasId: string, asset: CanvasAsset): boolean {
  return asset.canvasId === canvasId || store.getNodes(canvasId).some((node) =>
    ['image', 'anchor', 'frameExtractor', 'video', 'audio'].includes(node.type) &&
    (node.output?.assets?.includes(asset.path) || node.type === 'anchor' && (node.params as { assetId?: string }).assetId === asset.id));
}
