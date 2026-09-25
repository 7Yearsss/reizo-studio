import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'reizo:lazy-reload';

/**
 * React.lazy with resilience to stale module graphs: a `Failed to fetch
 * dynamically imported module` happens when the Vite dev server restarted (or
 * the app updated) while the page kept an old `?t=` timestamp — the chunk is
 * gone for good, so retrying the same URL won't help, but a reload will.
 *
 * Retry a few times first (covers transient network hiccups), then trigger a
 * single automatic reload guarded by a sessionStorage flag so we never loop.
 */
export function lazyWithRetry<T extends ComponentType<never>>(
  importer: () => Promise<{ default: T }>,
  retries = 2,
) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const mod = await importer();
        // Module resolved — a later failure elsewhere may reload, so keep the
        // guard key fresh by clearing any stale flag set by an earlier crash.
        sessionStorage.removeItem(RELOAD_KEY);
        return mod;
      } catch (err) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
        if (!alreadyReloaded) {
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
          // React keeps this lazy pending; the reload resets everything.
          return new Promise<{ default: T }>(() => undefined);
        }
        throw err;
      }
    }
  });
}
