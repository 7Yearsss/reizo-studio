/**
 * `reizo://` links. A link only ever *proposes* something: the app shows a confirmation card and nothing is written
 * until the user accepts. The parser is a default-deny allowlist — an unknown host, a stray parameter value or an
 * odd character means "not a link we understand" and the link is dropped.
 */
export const DEEP_LINK_PROTOCOL = 'reizo';

export type DeepLinkAction = { kind: 'install-skill'; namespace: string; slug: string; version?: string };

const IDENT = /^[A-Za-z0-9][\w.-]{0,79}$/;
const VERSION = /^[\w.+-]{1,40}$/;

export function parseDeepLink(raw: string): DeepLinkAction | null {
  if (typeof raw !== 'string' || raw.length > 2_000) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
  // reizo://skill/install?... → host "skill", path "/install"
  if (url.hostname.toLowerCase() === 'skill' && url.pathname.replace(/\/+$/, '') === '/install') {
    const namespace = url.searchParams.get('namespace') ?? '';
    const slug = url.searchParams.get('slug') ?? '';
    const version = url.searchParams.get('version') ?? undefined;
    if (!IDENT.test(namespace) || !IDENT.test(slug)) return null;
    if (version !== undefined && !VERSION.test(version)) return null;
    return { kind: 'install-skill', namespace, slug, ...(version ? { version } : {}) };
  }
  return null;
}

/** The first `reizo://` argument of a command line (Windows/Linux deliver a link as an argv entry). */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`)) ?? null;
}
