import { isIP } from 'node:net';

/** Why a provider-returned URL must not be fetched, or null when its syntax is acceptable (the host still needs DNS checking). */
export function rejectRemoteUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return 'invalid URL'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `unsupported protocol ${url.protocol}`;
  if (url.username || url.password) return 'URL carries credentials';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return 'missing host';
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'local hostname';
  if (isIP(host) && isPrivateAddress(host)) return 'private address';
  return null;
}

/**
 * Loopback, private, link-local, CGNAT, multicast and reserved ranges. The
 * 198.18.0.0/15 block is deliberately allowed: Clash/Surge fake-IP DNS hands
 * out addresses there for ordinary public hosts.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (ip === '::' || ip === '::1') return true;
    // NAT64 (64:ff9b::/96) wraps a public IPv4 and is allowed.
    if (/^(fc|fd)/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip)) return true;
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}
