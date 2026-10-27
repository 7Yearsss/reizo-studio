/**
 * Which hosts a shell command may reach when network isolation is on. Default-deny: a host passes only if a rule
 * names it. Rules are an exact host, `*.example.com` (any subdomain, not the bare domain), a single IPv4 address or
 * an IPv4 CIDR. Private, loopback and link-local addresses are refused unless the user opted in, and the check is
 * made on the resolved address by the proxy, so a name that points at 127.0.0.1 does not slip through.
 */
export const BUILTIN_ALLOWED_HOSTS: readonly string[] = [
  'registry.npmjs.org', '*.npmjs.org', 'registry.yarnpkg.com',
  'pypi.org', 'files.pythonhosted.org',
  'crates.io', 'static.crates.io', 'index.crates.io',
  'proxy.golang.org', 'sum.golang.org', 'rubygems.org', 'index.rubygems.org',
  'github.com', '*.github.com', '*.githubusercontent.com', 'gitlab.com', 'bitbucket.org',
];

export function parseIPv4(text: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
}

const PRIVATE_V4: Array<[string, number]> = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['0.0.0.0', 8], ['100.64.0.0', 10]];

/** Loopback, private, link-local and unspecified addresses (IPv4 and the IPv6 equivalents). */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = parseIPv4(host.startsWith('::ffff:') ? host.slice(7) : host);
  if (v4 !== null) return PRIVATE_V4.some(([base, bits]) => inCidr(v4, parseIPv4(base)!, bits));
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return host === 'localhost' || host.endsWith('.localhost');
}

export type HostRule = { kind: 'exact'; host: string } | { kind: 'suffix'; suffix: string } | { kind: 'cidr'; base: number; bits: number };

export function parseHostRule(raw: string): HostRule | null {
  const text = raw.trim().toLowerCase();
  if (!text || text.length > 253 || /[\s/:@]/.test(text.replace(/\/\d{1,2}$/, ''))) return null;
  const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(text);
  if (cidr) {
    const base = parseIPv4(cidr[1]); const bits = Number(cidr[2]);
    return base !== null && bits <= 32 ? { kind: 'cidr', base, bits } : null;
  }
  if (text.startsWith('*.')) return /^[a-z0-9.-]+$/.test(text.slice(2)) && text.length > 3 ? { kind: 'suffix', suffix: text.slice(1) } : null;
  return /^[a-z0-9.-]+$/.test(text) ? { kind: 'exact', host: text } : null;
}

export function parseHostRules(lines: readonly string[]): HostRule[] {
  return lines.map(parseHostRule).filter((r): r is HostRule => r !== null);
}

/** `address` is the resolved IP when the caller has one; the name rules are checked against `host`. */
export function hostAllowed(host: string, rules: readonly HostRule[], options: { allowPrivate?: boolean; address?: string } = {}): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!options.allowPrivate && (isPrivateAddress(name) || (options.address !== undefined && isPrivateAddress(options.address)))) return false;
  const ip = parseIPv4(name);
  return rules.some((rule) => {
    if (rule.kind === 'exact') return rule.host === name;
    if (rule.kind === 'suffix') return ip === null && name.endsWith(rule.suffix);
    return ip !== null && inCidr(ip, rule.base, rule.bits);
  });
}
