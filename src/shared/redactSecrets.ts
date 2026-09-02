/**
 * Conservative secret redaction for text on its way to a model or a log.
 * Ported from cindy's `secretRedactor.ts`. This is NOT a full secret scanner —
 * it targets high-confidence provider token shapes plus one generic
 * assignment pattern. Rules are **append-only**: relaxing one is a privacy
 * change. Matches are replaced with `[REDACTED:<name>]`.
 */
interface Pattern {
  name: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'stripe-key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Generic: FOO_SECRET = "…" / TOKEN: '…' / API_KEY=… (>= 8 chars of value).
  {
    name: 'assignment',
    re: /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*\b\s*[:=]\s*)(["']?)((?!\[REDACTED)[^\s"']{8,})\2/gi,
  },
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { name, re } of PATTERNS) {
    if (name === 'assignment') {
      out = out.replace(re, (_m, lhs: string) => `${lhs}[REDACTED:secret]`);
    } else {
      out = out.replace(re, `[REDACTED:${name}]`);
    }
  }
  return out;
}

/** True if the string contains something that would be redacted. */
export function hasSecret(input: string): boolean {
  return redactSecrets(input) !== input;
}
