/**
 * A pack that needs a credential writes a placeholder, `${config.API_TOKEN}`, wherever the value goes (an MCP
 * server's env or headers, a hook command). The value itself is typed by the user, kept encrypted in the OS key
 * store and substituted only in memory when the pack runs — it is never written into the pack or any JSON file.
 */
const PLACEHOLDER = /\$\{config\.([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

export function findConfigNames(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Replace placeholders that have a value; ones without are left as they are so the caller can see them. */
export function substituteConfig(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (match, name: string) => (Object.hasOwn(values, name) ? values[name] : match));
}

export function hasUnresolvedConfig(text: string): boolean {
  return findConfigNames(text).length > 0;
}

export function isConfigName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
}
