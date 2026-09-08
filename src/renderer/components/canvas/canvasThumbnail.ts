import type { CanvasNode } from '../../../shared/canvas';
import { canvasAssetUrlSync } from '../../api';

/**
 * Extracts a thumbnail preview URL for any canvas node, resolving local asset
 * paths to URLs and falling back to imageUrl/videoUrl parameters.
 */
export function getCanvasNodeThumbnail(node: CanvasNode): string | undefined {
  const rel =
    node.output?.assets?.[node.output?.activeAssetIndex ?? 0] ??
    node.output?.assets?.[0] ??
    node.output?.resultSet?.[node.output?.activeAssetIndex ?? 0]?.asset ??
    node.output?.resultSet?.[0]?.asset;
  if (rel) {
    const url = canvasAssetUrlSync(rel);
    if (url) return url;
  }
  const p = (node.params as Record<string, unknown>) ?? {};
  if (typeof p.imageUrl === 'string' && p.imageUrl) return p.imageUrl;
  if (typeof p.videoUrl === 'string' && p.videoUrl) return p.videoUrl;
  const assets = (node as { assets?: { url: string }[] }).assets;
  if (assets?.[0]?.url) return assets[0].url;
  return undefined;
}
