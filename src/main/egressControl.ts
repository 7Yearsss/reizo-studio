import { BUILTIN_ALLOWED_HOSTS, parseHostRules, type HostRule } from '../shared/networkAllowlist';
import { DEFAULT_EGRESS, type EgressSettings } from '../shared/egressSettings';
import { startEgressProxy, type EgressProxy } from './egressProxy';
import { currentProxyUrl } from './proxy';

let settings: EgressSettings = { ...DEFAULT_EGRESS, allow: [] };
let rules: HostRule[] = parseHostRules(BUILTIN_ALLOWED_HOSTS);
let proxy: EgressProxy | null = null;
const blocked = new Map<string, number>();

/** Start, stop or re-aim the isolation proxy so it matches `next`. Rules are read live, so editing them needs no restart. */
export async function applyEgress(next: EgressSettings): Promise<void> {
  settings = next;
  rules = parseHostRules([...BUILTIN_ALLOWED_HOSTS, ...next.allow]);
  if (!next.enabled) {
    const old = proxy;
    proxy = null;
    await old?.close();
    return;
  }
  if (proxy) return;
  proxy = await startEgressProxy({
    rules: () => rules,
    allowPrivate: () => settings.allowPrivate,
    upstream: currentProxyUrl,
    onBlocked: (host) => { blocked.set(host, Date.now()); if (blocked.size > 50) blocked.delete(blocked.keys().next().value as string); },
  });
}

/** Proxy variables for an agent-run command; empty when isolation is off, so nothing changes for the default user. */
export function egressEnv(): Record<string, string> {
  if (!proxy) return {};
  const url = proxy.url;
  // No NO_PROXY: loopback and private targets must also pass the filter.
  return { HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url, NO_PROXY: '', no_proxy: '' };
}

export function recentlyBlocked(): Array<{ host: string; at: number }> {
  return [...blocked.entries()].map(([host, at]) => ({ host, at })).sort((a, b) => b.at - a.at);
}

/** Hosts a command tried to reach and was refused, since `since` (ms epoch). */
export function blockedSince(since: number): string[] {
  return [...blocked.entries()].filter(([, at]) => at >= since).map(([host]) => host);
}

export async function stopEgress(): Promise<void> {
  await applyEgress({ ...settings, enabled: false });
}
