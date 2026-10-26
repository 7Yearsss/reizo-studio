import { redactSecrets } from './redactSecrets';

/**
 * Scrubbing for the diagnostic bundle a user may send to a maintainer. Two layers that cannot be switched off:
 * field names that hold secrets are replaced wholesale, and every remaining string goes through the value-shape
 * redactor. Inline images become a size placeholder; very long text is cut. Nothing here is reversible.
 */
const SECRET_FIELD = /(api[_-]?key|secret|token|password|passwd|authorization|cookie|credential|private[_-]?key|bearer)/i;
const DATA_URI = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{200,})/g;
const BARE_BASE64 = /^[A-Za-z0-9+/=\s]{2000,}$/;
const MAX_STRING = 4000;
const MAX_DEPTH = 12;

function placeholderForImage(mime: string, base64: string): string {
  const kb = Math.max(1, Math.round((base64.length * 3) / 4 / 1024));
  return `[image: ${kb}KB ${mime.split('/')[1] ?? 'bin'}]`;
}

export function scrubString(text: string): string {
  if (BARE_BASE64.test(text)) return `[binary: ${Math.round((text.length * 3) / 4 / 1024)}KB]`;
  let out = text.replace(DATA_URI, (_m, mime: string, data: string) => placeholderForImage(mime, data));
  out = redactSecrets(out);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[${out.length - MAX_STRING} chars cut]` : out;
}

export function scrubValue(value: unknown, key = '', depth = 0): unknown {
  if (key && SECRET_FIELD.test(key) && value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && typeof value !== 'number') return '[REDACTED:field]';
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => scrubValue(item, key, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubValue(v, k, depth + 1)]));
}
