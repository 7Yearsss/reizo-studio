import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM_CSS_CHARS, sanitizeCustomCss, UI_ROLES } from './customCss';

describe('sanitizeCustomCss', () => {
  it('keeps ordinary rules, including attribute selectors on the public roles', () => {
    const css = "[data-ui~='chat.message']{max-width:none}\n.markdown{font-size:15px}";
    expect(sanitizeCustomCss(css)).toEqual({ css, removed: [] });
  });
  it('drops @import (nothing external is loaded) and reports it', () => {
    const out = sanitizeCustomCss('@import url("https://evil.test/x.css");\nbody{color:red}');
    expect(out.css).toBe('body{color:red}');
    expect(out.removed).toHaveLength(1);
  });
  it('cannot close the style element', () => {
    expect(sanitizeCustomCss('a{}</style><script>x</script>').css).not.toMatch(/<\/style/i);
  });
  it('caps the length', () => {
    expect(sanitizeCustomCss('a'.repeat(MAX_CUSTOM_CSS_CHARS + 500)).css.length).toBe(MAX_CUSTOM_CSS_CHARS);
  });
  it('lists the public roles', () => {
    expect(UI_ROLES).toContain('chat.message');
  });
});
