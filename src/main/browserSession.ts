import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Session } from 'electron';
import { browserRequestAllowed, browserUrlProblem } from '../shared/browserUrl';
import { isPrivateAddress } from '../shared/networkAllowlist';

export const BROWSER_PARTITION = 'persist:reizo-browser';
type Resolver = (host: string) => Promise<string[]>;
const resolveHost: Resolver = async host => (await lookup(host, { all: true })).map(item => item.address);

export async function publicBrowserRequest(raw: string, resolve: Resolver = resolveHost): Promise<boolean> {
  if (!browserRequestAllowed(raw)) return false;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  try {
    const addresses = isIP(host) ? [host] : await resolve(host);
    return addresses.length > 0 && addresses.every(address => !isPrivateAddress(address));
  } catch { return false; }
}

/** Shared by the page reader, visible login browser, and video reader. No desktop preload or credentials. */
export function hardenBrowserSession(ses: Session): void {
  const pending = new Map<string, Promise<boolean>>();
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Only coalesce concurrent DNS lookups; do not retain stale DNS decisions across requests.
    let check = pending.get(details.url);
    if (!check) { check = publicBrowserRequest(details.url); pending.set(details.url, check); }
    void check.then(allowed => callback({ cancel: !allowed }), () => callback({ cancel: true }))
      .finally(() => pending.delete(details.url));
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.removeAllListeners('will-download');
  ses.on('will-download', event => event.preventDefault());
}

export async function assertPublicBrowserPage(url: string): Promise<void> {
  const problem = browserUrlProblem(url);
  if (problem || !(await publicBrowserRequest(url))) throw new Error(problem || '不能访问本机、内网或无法解析的地址');
}
