import { describe, expect, it } from 'vitest';
import { withHtmlPreviewGuard, HTML_PREVIEW_GUARD_SCRIPT } from './htmlGuards';

describe('withHtmlPreviewGuard', () => {
  it('injects guard script into <head> when present', () => {
    const raw = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
    const guarded = withHtmlPreviewGuard(raw);
    expect(guarded).toContain('<head><script>');
    expect(guarded).toContain('reizo:preview-error');
    expect(guarded).toContain('reizo:set-inspect-mode');
    expect(guarded).toContain('reizo:element-selected');
  });

  it('injects guard script into <html> when <head> is missing', () => {
    const raw = '<html><body><h1>Hello</h1></body></html>';
    const guarded = withHtmlPreviewGuard(raw);
    expect(guarded).toContain('<html><script>');
    expect(guarded).toContain('data-reizo-inspector');
  });

  it('prepends guard script when neither html nor head is present', () => {
    const raw = '<div>Snippet</div>';
    const guarded = withHtmlPreviewGuard(raw);
    expect(guarded.startsWith('<script>')).toBe(true);
    expect(guarded).toContain('<div>Snippet</div>');
  });
});
