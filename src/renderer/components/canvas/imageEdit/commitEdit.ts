import type { CanvasNode } from '../../../../shared/canvas';
import type { ImageEditSpec } from '../../../../shared/canvasImageEdit';
import * as canvasStore from '../../../state/canvasStore';

export type EditCommitMode = 'derive' | 'revise';

export async function commitImageEdit(
  mode: EditCommitMode,
  sessionId: string,
  node: CanvasNode,
  spec: Omit<ImageEditSpec, 'sourceNodeId'>,
  opts?: { localResultBlob?: Blob; maskBlob?: Blob },
): Promise<string | null> {
  if (mode === 'revise') {
    await canvasStore.reviseImageEdit(
      sessionId,
      node.id,
      { params: spec.params, instruction: spec.instruction, cropRect: spec.cropRect, regions: spec.regions },
      opts,
    );
    return node.id;
  }
  return canvasStore.deriveImageEdit(sessionId, node.id, spec, opts);
}
