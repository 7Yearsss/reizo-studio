import type { HookEntry, McpServerEntry } from '../../../shared/extensionConfig';

/** `KEY=value` (env) or `Name: value` (headers), one per line. Blank lines and lines without the separator are skipped. */
export function parseKeyValueLines(text: string, separator: '=' | ':'): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) result[key] = line.slice(at + 1).trim();
  }
  return Object.keys(result).length ? result : undefined;
}

export function formatKeyValueLines(record: Record<string, string> | undefined, separator: '=' | ':'): string {
  return Object.entries(record ?? {}).map(([k, v]) => (separator === ':' ? `${k}: ${v}` : `${k}=${v}`)).join('\n');
}

/** One argument per line, so arguments containing spaces need no quoting. */
export function parseArgLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const SECRET_KEY = /key|token|secret|password|authorization|cookie/i;

/** Hide the value of likely secrets when showing env or headers back to the user. */
export function maskSecrets(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, SECRET_KEY.test(k) && v ? '••••••' : v]));
}

/** What the server is, in one line for its card: the command line or URL. */
export function describeMcpEntry(entry: McpServerEntry): string {
  return entry.transport === 'stdio' ? [entry.command, ...(entry.args ?? [])].join(' ') : (entry.url ?? '');
}

export function describeHook(hook: HookEntry): string {
  const when = hook.event === 'PreToolUse' ? '调用工具前' : '调用工具后';
  return `${when} · ${hook.matcher ? `工具匹配 ${hook.matcher}` : '所有工具'}`;
}

export const EMPTY_MCP: McpServerEntry = { name: '', transport: 'stdio', command: '', args: [] };
export const EMPTY_HOOK: HookEntry = { event: 'PreToolUse', matcher: '', command: '' };
