/**
 * Whether the user is dragging a panel edge right now. Plain module state (no
 * React) so ResizeObserver callbacks can check it without subscribing: while a
 * drag is live, layout-derived bookkeeping that nobody reads mid-drag (message
 * rail previews, smooth scroll-follow) is skipped and runs once on release.
 */
let resizing = false;
const endListeners = new Set<() => void>();

export function isPanelResizing(): boolean {
  return resizing;
}

export function setPanelResizing(next: boolean): void {
  if (resizing === next) return;
  resizing = next;
  if (!next) for (const listener of [...endListeners]) listener();
}

export function onPanelResizeEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}
