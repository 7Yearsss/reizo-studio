export const OPEN_REGION_MARK_EVENT = 'reizo:open-region-mark';

export interface OpenRegionMarkDetail {
  sessionId: string;
  nodeId: string;
}

/** Ask an ImageNode to open its region-mark overlay (mark a rect → composer ref chip). */
export function openRegionMark(detail: OpenRegionMarkDetail): void {
  window.dispatchEvent(new CustomEvent<OpenRegionMarkDetail>(OPEN_REGION_MARK_EVENT, { detail }));
}
