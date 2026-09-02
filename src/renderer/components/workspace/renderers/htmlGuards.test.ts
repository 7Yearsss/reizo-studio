import { describe, expect, it } from 'vitest';
import { withHtmlPreviewGuard, HTML_PREVIEW_GUARD_SCRIPT } from './htmlGuards';

describe('withHtmlPreviewGuard', () => {
  it('injects the guard right after <head>', () => {
    const out = withHtmlPreviewGuard('<html><head><title>x</title></head><body>hi</body></html>');
    expect(out).toContain('<head><script>');
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('<title>'));
  });

  it('falls back to <html> when there is no head', () => {
    const out = withHtmlPreviewGuard('<html><body>hi</body></html>');
    expect(out).toMatch(/^<html><script>/);
  });

  it('prepends when there is neither head nor html', () => {
    const out = withHtmlPreviewGuard('<div>bare fragment</div>');
    expect(out.startsWith('<script>')).toBe(true);
    expect(out).toContain('<div>bare fragment</div>');
  });

  it('the guard neutralises the three known vectors', () => {
    expect(HTML_PREVIEW_GUARD_SCRIPT).toContain('window.focus = noop');
    expect(HTML_PREVIEW_GUARD_SCRIPT).toContain('location.reload =');
    expect(HTML_PREVIEW_GUARD_SCRIPT).toContain("shim('localStorage')");
  });
});
