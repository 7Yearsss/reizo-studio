/**
 * Splits streaming markdown into a sequence of already-"sealed" top-level
 * prefix blocks plus one growing tail. Sealed blocks get a stable `start`
 * offset as their React key so they can be `React.memo`'d and never
 * re-parsed / re-highlighted again; only the tail re-parses per token.
 *
 * Boundaries land only on blank lines that are OUTSIDE fenced code, `$$`
 * math blocks and `:::` directive blocks. When the document needs
 * whole-document context (reference-style link definitions, multiple
 * headings, or a possible raw-HTML block), splitting is unsafe — the whole
 * string is returned as a single unsealed chunk.
 */

export interface MarkdownChunk {
  /** Character offset of this chunk's first character in the full string. */
  start: number;
  text: string;
  /** A sealed chunk will not change as more text streams in. */
  sealed: boolean;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
const MATH_FENCE_RE = /^\s*\$\$\s*$/;
const DIRECTIVE_RE = /^\s*:::/;
const REF_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s+\S/;
const ATX_HEADING_RE = /^\s{0,3}#{1,6}\s/;
const HTML_BLOCK_RE = /^\s{0,3}<([a-zA-Z][a-zA-Z0-9-]*)(\s|>|\/|$)/;

export function needsWholeDocumentContext(md: string): boolean {
  let headings = 0;
  let inFence = false;
  let fenceMarker = '';
  for (const line of md.split('\n')) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[2][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    if (REF_DEF_RE.test(line)) return true;
    if (HTML_BLOCK_RE.test(line)) return true;
    if (ATX_HEADING_RE.test(line)) {
      headings += 1;
      if (headings > 1) return true;
    }
  }
  return false;
}

export function splitStreamingMarkdownChunks(md: string): MarkdownChunk[] {
  if (!md) return [{ start: 0, text: '', sealed: false }];
  if (needsWholeDocumentContext(md)) return [{ start: 0, text: md, sealed: false }];

  const lines = md.split('\n');
  let inFence = false;
  let fenceMarker = '';
  let inMath = false;
  let inDirective = false;

  // Byte offset at the start of each line.
  const lineStart: number[] = [];
  {
    let acc = 0;
    for (const line of lines) {
      lineStart.push(acc);
      acc += line.length + 1; // + '\n'
    }
  }

  const boundaries: number[] = []; // line indices where a new sealed chunk can begin
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[2][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    if (MATH_FENCE_RE.test(line)) {
      inMath = !inMath;
      continue;
    }
    if (inMath) continue;
    if (DIRECTIVE_RE.test(line)) {
      inDirective = !inDirective;
      continue;
    }
    if (inDirective) continue;

    // A blank line outside every block, with real content after it, is a
    // safe seam.
    if (line.trim() === '' && i + 1 < lines.length) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (j < lines.length) boundaries.push(j);
    }
  }

  if (boundaries.length === 0) return [{ start: 0, text: md, sealed: false }];

  const chunks: MarkdownChunk[] = [];
  let prevLine = 0;
  for (const b of boundaries) {
    const start = lineStart[prevLine];
    const end = lineStart[b];
    chunks.push({ start, text: md.slice(start, end), sealed: true });
    prevLine = b;
  }
  const tailStart = lineStart[prevLine];
  chunks.push({ start: tailStart, text: md.slice(tailStart), sealed: false });
  return chunks;
}
