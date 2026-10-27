import { BUILTIN_ALLOWED_HOSTS, parseHostRule } from './networkAllowlist';

/** Network isolation for commands the agent runs. Off by default; the user's own rules extend the built-in list. */
export interface EgressSettings {
  enabled: boolean;
  /** Extra hosts (exact, `*.x.com`, IPv4 / CIDR) one per entry. */
  allow: string[];
  allowPrivate: boolean;
}

export const DEFAULT_EGRESS: EgressSettings = { enabled: false, allow: [], allowPrivate: false };
const MAX_RULES = 100;

export function normalizeEgress(value: unknown): EgressSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_EGRESS, allow: [] };
  const v = value as Record<string, unknown>;
  const seen = new Set<string>();
  const allow: string[] = [];
  for (const raw of Array.isArray(v.allow) ? v.allow : []) {
    if (typeof raw !== 'string') continue;
    const rule = raw.trim().toLowerCase();
    if (!parseHostRule(rule) || seen.has(rule) || BUILTIN_ALLOWED_HOSTS.includes(rule)) continue;
    seen.add(rule);
    allow.push(rule);
    if (allow.length >= MAX_RULES) break;
  }
  return { enabled: v.enabled === true, allow, allowPrivate: v.allowPrivate === true };
}

/** Add one host to the user's rules (used by the "allow this host" button); unchanged when invalid or already covered. */
export function withAllowedHost(settings: EgressSettings, host: string): EgressSettings {
  return normalizeEgress({ ...settings, allow: [...settings.allow, host] });
}
