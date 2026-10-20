/**
 * A small script prepended to any agent-authored HTML we drop into a preview
 * iframe. `sandbox=""` already blocks scripts entirely, but the moment we
 * relax that (previews that need to run), an artifact can:
 *   - steal the host's keyboard with `window.focus()` / autofocus loops
 *   - freeze the frame with `<meta http-equiv=refresh>` or a `location.reload`
 *     loop
 *   - throw on `localStorage` / `history` because the frame is an opaque origin
 *   - crash silently with unhandled errors
 *
 * These guards neutralise focus/reload/storage throws and report unhandled runtime
 * errors to the parent frame so users get immediate visibility instead of a blank screen.
 * It also embeds the DOM Element Inspector Bridge for click-to-annotate UX.
 * Ported and enhanced from Open Design's preview architecture.
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

    // 4. Runtime error reporter: post errors to the parent frame so the user knows if code broke.
    window.addEventListener('error', function (evt) {
      try {
        window.parent.postMessage({
          type: 'reizo:preview-error',
          message: evt.message || '未知脚本错误',
          lineno: evt.lineno,
          colno: evt.colno,
        }, '*');
      } catch (err) {}
    });

    // 5. DOM Element Inspector Bridge: hover highlight & click-to-annotate
    var inspectActive = false;
    var overlay = null;
    var badge = null;
    var currentTarget = null;

    function createOverlay() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.setAttribute('data-reizo-inspector', 'true');
      overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;border-radius:3px;background:rgba(59,130,246,0.12);transition:top 0.08s ease,left 0.08s ease,width 0.08s ease,height 0.08s ease;display:none;box-sizing:border-box;';
      
      badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;bottom:100%;left:0;margin-bottom:3px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#f8fafc;font-size:10px;font-family:monospace;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.25);pointer-events:none;line-height:1.3;max-width:260px;overflow:hidden;text-overflow:ellipsis;';
      overlay.appendChild(badge);
      document.documentElement.appendChild(overlay);
    }

    function getSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return el ? el.tagName.toLowerCase() : '';
      var path = [];
      var curr = el;
      while (curr && curr !== document.body && curr !== document.documentElement && path.length < 4) {
        var seg = curr.tagName.toLowerCase();
        if (curr.id) {
          seg += '#' + curr.id;
          path.unshift(seg);
          break;
        } else if (curr.className && typeof curr.className === 'string') {
          var cls = curr.className.trim().split(/\\s+/).filter(function(c) { return c && !c.includes(':'); })[0];
          if (cls) seg += '.' + cls;
        }
        path.unshift(seg);
        curr = curr.parentElement;
      }
      return path.join(' > ');
    }

    function onMouseMove(e) {
      if (!inspectActive) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === document.body || el === document.documentElement || el.hasAttribute('data-reizo-inspector') || (overlay && overlay.contains(el))) {
        if (overlay) overlay.style.display = 'none';
        currentTarget = null;
        return;
      }
      currentTarget = el;
      createOverlay();
      var rect = el.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      var tag = el.tagName.toLowerCase();
      var firstClass = (typeof el.className === 'string' && el.className.trim().split(/\\s+/)[0]) || '';
      var text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
      badge.textContent = '<' + tag + (firstClass ? '.' + firstClass : '') + '>' + (text ? ' "' + text + '"' : '');
    }

    function onClick(e) {
      if (!inspectActive || !currentTarget) return;
      e.preventDefault();
      e.stopPropagation();

      var el = currentTarget;
      var rect = el.getBoundingClientRect();
      var text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
      var html = (el.outerHTML || '').slice(0, 180);

      window.parent.postMessage({
        type: 'reizo:element-selected',
        element: {
          tagName: el.tagName.toLowerCase(),
          selector: getSelector(el),
          textSnippet: text,
          htmlSnippet: html,
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        }
      }, '*');
    }

    window.addEventListener('message', function(evt) {
      if (evt.data && evt.data.type === 'reizo:set-inspect-mode') {
        inspectActive = Boolean(evt.data.enabled);
        if (!inspectActive && overlay) {
          overlay.style.display = 'none';
          currentTarget = null;
        }
      }
    });

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('click', onClick, true);
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
