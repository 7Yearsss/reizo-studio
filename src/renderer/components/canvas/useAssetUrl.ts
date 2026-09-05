import { useSyncExternalStore } from 'react';
import { canvasAssetUrlSync, getResolvedApiOrigin, subscribeApiOrigin, warmApiOrigin } from '../../api';

/**
 * Resolves a canvas asset's relative path to a full URL.
 *
 * Deliberately synchronous (via `useSyncExternalStore`) rather than a `useState` + `useEffect`
 * pair: nodes mount/unmount repeatedly as they cross the `onlyRenderVisibleElements` viewport
 * boundary while panning, and an effect-driven fetch would reset to "no asset yet" on every
 * remount, flashing the card's empty/placeholder state before the asset resolves again. The api
 * origin is resolved once near app startup and never changes after, so once warm this is just a
 * string template with no async gap at all.
 */
export function useAssetUrl(rel: string | undefined): string | null {
  warmApiOrigin();
  const origin = useSyncExternalStore(subscribeApiOrigin, getResolvedApiOrigin, getResolvedApiOrigin);
  if (!rel || !origin) return null;
  return canvasAssetUrlSync(rel);
}
