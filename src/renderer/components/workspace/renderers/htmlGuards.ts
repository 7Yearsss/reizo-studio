/**
 * A small script prepended to any agent-authored HTML we drop into a preview
 * iframe. `sandbox=""` already blocks scripts entirely, but the moment we
 * relax that (previews that need to run), an artifact can:
 *   - steal the host's keyboard with `window.focus()` / autofocus loops
 *   - freeze the frame with `<meta http-equiv=refresh>` or a `location.reload`
 *     loop
 *   - throw on `localStorage` / `history` because the frame is an opaque origin
 *
 * These guards neutralise all three without changing what a well-behaved page
 * sees. Ported from open-design's `file-viewer-render-mode` detection notes.
 */
export const HTML_PREVIEW_GUARD_SCRIPT = `
(function () {
  try {
    // 1. Focus guard: a preview must never pull focus off the host app.
    var noop = function () {};
    try { window.focus = noop; } catch (e) {}
    try {
      var _elFocus = Element.prototype.focus;
      Element.prototype.focus = function () {
        // Allow focus only in response to a real user gesture inside the frame.
        if (window.__reizoUserGesture) return _elFocus.apply(this, arguments);
      };
      window.addEventListener('pointerdown', function () { window.__reizoUserGesture = true; }, true);
      window.addEventListener('keydown', function () { window.__reizoUserGesture = true; }, true);
    } catch (e) {}

    // 2. Redirect-loop guard: rate-limit navigation-to-self.
    var reloads = 0;
    var since = Date.now();
    function tooMany() {
      if (Date.now() - since > 4000) { reloads = 0; since = Date.now(); }
      reloads += 1;
      return reloads > 3;
    }
    try {
      var _reload = location.reload.bind(location);
      location.reload = function () { if (!tooMany()) _reload(); };
    } catch (e) {}
    try {
      var _assign = location.assign.bind(location);
      location.assign = function (u) { if (!tooMany()) _assign(u); };
    } catch (e) {}
    // Strip meta-refresh tags before they fire.
    try {
      document.addEventListener('DOMContentLoaded', function () {
        var metas = document.querySelectorAll('meta[http-equiv]');
        for (var i = 0; i < metas.length; i++) {
          if (String(metas[i].getAttribute('http-equiv')).toLowerCase() === 'refresh') {
            metas[i].parentNode && metas[i].parentNode.removeChild(metas[i]);
          }
        }
      });
    } catch (e) {}

    // 3. Storage shim: opaque-origin frames throw on these; make them inert.
    function shim(name) {
      try { void window[name]; return; } catch (e) {}
      var mem = {};
      try {
        Object.defineProperty(window, name, {
          value: {
            getItem: function (k) { return k in mem ? mem[k] : null; },
            setItem: function (k, v) { mem[k] = String(v); },
            removeItem: function (k) { delete mem[k]; },
            clear: function () { mem = {}; },
            key: function (i) { return Object.keys(mem)[i] || null; },
            get length() { return Object.keys(mem).length; },
          },
          configurable: true,
        });
      } catch (e) {}
    }
    shim('localStorage');
    shim('sessionStorage');
  } catch (e) {}
})();
`;

/** Prepend the guard to an HTML document string for use as an iframe srcDoc. */
export function withHtmlPreviewGuard(html: string): string {
  const tag = `<script>${HTML_PREVIEW_GUARD_SCRIPT}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>${tag}`);
  return tag + html;
}
