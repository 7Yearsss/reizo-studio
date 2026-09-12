import type { ImageEditKind } from '../../../../shared/canvasImageEdit';
import type { EditCommitMode } from './commitEdit';

export const OPEN_IMAGE_EDIT_EVENT = 'reizo:open-image-edit';

export interface OpenImageEditDetail {
  sessionId: string;
  nodeId: string;
  kind: ImageEditKind;
  commitMode?: EditCommitMode;
}

export function openImageEdit(detail: OpenImageEditDetail): void {
  window.dispatchEvent(new CustomEvent<OpenImageEditDetail>(OPEN_IMAGE_EDIT_EVENT, { detail }));
}
