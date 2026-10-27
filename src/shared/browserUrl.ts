import { isPrivateAddress } from './networkAllowlist';

/**
 * What the built-in page reader may load, for the page itself and for every request the page makes. Public http(s)
 * only: no credentials in the address, nothing on this machine or a private network, no file:, ftp: or other schemes.
 * (A name that resolves to a private address can still get through this check; the reader also refuses navigation
 * it cannot account for, and runs with no login state.)
 */
export function browserUrlProblem(raw: string): string | null {
  if (raw.length > 2000) return '地址过长';
  let url: URL;
  try { url = new URL(raw); } catch { return '地址无效'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只能打开 http / https 地址';
  if (url.username || url.password) return '地址里不能带账号密码';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || isPrivateAddress(host) || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':')) return '不能访问本机或内网地址';
  return null;
}

/** Sub-resources a page may pull in: the same public web, plus inline `data:` / `blob:` content. */
export function browserRequestAllowed(raw: string): boolean {
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;
  return browserUrlProblem(raw) === null;
}
