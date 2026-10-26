export const MAX_CUSTOM_CSS_CHARS = 20_000;

/**
 * User CSS is applied as-is except for what could pull in remote code or break out of the style element:
 * @import rules are removed (nothing external is loaded), and "</style" is neutralised. Length is capped.
 */
export function sanitizeCustomCss(css: string): { css: string; removed: string[] } {
  const removed: string[] = [];
  let out = css.slice(0, MAX_CUSTOM_CSS_CHARS);
  out = out.replace(/@import\b[^;]*;?/gi, (m) => { removed.push(m.trim()); return ''; });
  out = out.replace(/<\/style/gi, '< /style');
  return { css: out.trim(), removed };
}

/** The public styling hooks (see docs/ui-contract.md). Renaming one needs an alias. */
export const UI_ROLES = [
  'app.titlebar', 'app.sidebar', 'chat.message', 'chat.message.user', 'chat.message.assistant', 'chat.composer', 'part:message-content',
] as const;
