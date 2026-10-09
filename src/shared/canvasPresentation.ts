import type { CanvasNode } from './canvas';
export interface PresentationPage { nodeId?: string; assetId?: string; expectedPath?: string }
export interface PresentationExportRequest { pages: PresentationPage[]; title?: string; planId?: string }
export interface PresentationSource { nodeId?: string; assetId?: string; path: string; contentHash?: string; title: string }
export interface DeliveryExport { id: string; planId: string; artifactId: string; artifactVersion: number; format: 'pptx'; jobId: string;
  sourceAssetIds: string[]; pageCount: number; contentHash: string; createdAt: string }
export function isPresentationExportNode(node: Pick<CanvasNode, 'type' | 'params'> | undefined): boolean {
  return node?.type === 'note' && (node.params as { localExport?: { kind?: string } })?.localExport?.kind === 'pptx-image-pages';
}
