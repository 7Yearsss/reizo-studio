export const OPEN_ANIMATE_EVENT = 'reizo:open-animate';

export interface OpenAnimateDetail {
  sessionId: string;
  nodeId: string;
}

/** Ask an ImageNode to open its animate overlay (image → video node pipeline). */
export function openAnimate(detail: OpenAnimateDetail): void {
  window.dispatchEvent(new CustomEvent<OpenAnimateDetail>(OPEN_ANIMATE_EVENT, { detail }));
}
