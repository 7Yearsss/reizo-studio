const BACKSLASH = String.fromCharCode(92);
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '/': '/', [BACKSLASH]: BACKSLASH };

/** Decode a JSON string body that may stop mid-escape; an incomplete trailing escape is dropped. */
function decodeBody(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== BACKSLASH) { out += ch; continue; }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ESCAPES[next] ?? next;
      i += 1;
    }
  }
  return out;
}

/** Index just past `"key":"` for the first top-level-looking occurrence, or -1. */
function valueStart(text: string, key: string): number {
  const needle = `"${key}"`;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return -1;
    let i = at + needle.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === ':') {
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '"') return i + 1;
      return -1;
    }
    from = at + needle.length;
  }
}

/**
 * String fields of a JSON object that is still being written (streamed tool arguments).
 * A value that has started but not finished is returned as written so far; keys not yet reached are absent.
 */
export function partialStringFields(text: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    let i = valueStart(text, key);
    if (i < 0) continue;
    let body = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === BACKSLASH) { body += text.slice(i, i + 2); i += 2; continue; }
      if (ch === '"') break;
      body += ch;
      i += 1;
    }
    out[key] = decodeBody(body);
  }
  return out;
}
