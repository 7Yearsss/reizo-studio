import type { CanvasNode } from './canvas';
import type { CanvasAsset } from './canvasAssets';

export class CanvasReferenceError extends Error {}

/** The selected version, with the same first-version fallback used by legacy outputs. */
export function selectedAsset(node: Pick<CanvasNode, 'output'>): string | undefined {
  const assets = node.output?.assets ?? [];
  return assets[node.output?.activeAssetIndex ?? 0] ?? assets[0];
}

/** Resolve fixed identities once, before job admission, and freeze their effective paths. */
export function captureReferenceNodes(
  nodes: CanvasNode[],
  getAsset: (id: string) => CanvasAsset | null,
): { nodes: CanvasNode[]; requiredAssetPaths: string[] } {
  const captured = structuredClone(nodes);
  const requiredAssetPaths = new Set<string>();
  for (const node of captured) {
    if (node.type !== 'anchor') continue;
    const assetId = (node.params as { assetId?: unknown }).assetId;
    if (assetId === undefined) continue;
    if (typeof assetId !== 'string' || !assetId.trim()) throw new CanvasReferenceError('固定参考缺少有效的资源 ID');
    const asset = getAsset(assetId);
    if (!asset) throw new CanvasReferenceError(`固定参考资源不存在：${assetId}`);
    if (asset.kind !== 'image' && asset.kind !== 'mask') throw new CanvasReferenceError('固定参考仅支持图片资源');
    node.output = { ...node.output, assets: [asset.path], activeAssetIndex: 0 };
    requiredAssetPaths.add(asset.path);
  }
  return { nodes: captured, requiredAssetPaths: [...requiredAssetPaths] };
}
