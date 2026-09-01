/**
 * Models often close a fenced block and keep writing on the same line:
 *
 *     ```text
 *     commit title
 *     ```后面的正文变成了 markdown
 *
 * CommonMark only treats a fence as closed when the rest of the line is
 * spaces/tabs. Trailing prose keeps the fence open, so the rest of the
 * reply is swallowed as a TEXT code block. Split the closer from the
 * trailing text before parsing.
 */

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

function isWhitespaceOnly(value: string): boolean {
  return /^[ \t]*$/.test(value);
}

export function normalizeMarkdownFences(md: string): string {
  if (!md || (!md.includes('```') && !md.includes('~~~'))) return md;

  const lines = md.split('\n');
  let open: { marker: string; len: number } | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const fence = line.match(FENCE_RE);
    if (!fence) {
      out.push(line);
      continue;
    }

    const indent = fence[1];
    const ticks = fence[2];
    const rest = fence[3];
    const marker = ticks[0];
    const len = ticks.length;

    if (open === null) {
      open = { marker, len };
      out.push(line);
      continue;
    }

    if (marker === open.marker && len >= open.len) {
      if (isWhitespaceOnly(rest)) {
        open = null;
        out.push(line);
        continue;
      }
      out.push(`${indent}${ticks}`);
      open = null;
      const trailing = rest.replace(/^[ \t]+/, '');
      if (trailing) out.push(trailing);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}
