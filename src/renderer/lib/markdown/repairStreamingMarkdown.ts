/**
 * Temporarily closes unterminated block syntax during streaming so the
 * rendered structure doesn't flip-flop as tokens arrive (an open ``` fence
 * would otherwise swallow the rest of the message as code until it closes).
 *
 * Only ever applied to the streaming tail; the final render uses the raw
 * text, so a repair never reaches storage or the settled DOM. Deliberately
 * conservative — it must never turn legal text into something else:
 *
 *  1. Odd number of code fences -> append a closing fence.
 *  2. Odd number of inline backticks (half-open inline code) -> skip ALL
 *     inline repair; we can't tell whether later `*`/`_` are inside code.
 *  3. Odd number of `$$` (outside fences) -> append a closing `$$`.
 *  4. A trailing `**` opener followed by body text on the same line ->
 *     append `**`. Anything ambiguous is left literal.
 */

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;

export function repairStreamingMarkdown(md: string): string {
  if (!md) return md;
  const lines = md.split('\n');

  let openFence: string | null = null;
  let mathOpen = false;
  let backtickParity = 0; // inline backticks outside fences, mod 2

  for (const line of lines) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[2][0];
      if (openFence === null) openFence = marker;
      else if (openFence === marker) openFence = null;
      continue;
    }
    if (openFence !== null) continue;

    if (/^\s*\$\$\s*$/.test(line)) {
      mathOpen = !mathOpen;
      continue;
    }
    for (const ch of line) if (ch === '`') backtickParity ^= 1;
  }

  let out = md;
  if (openFence !== null) {
    const closing = openFence.repeat(3);
    out += (out.endsWith('\n') ? '' : '\n') + closing;
    return out; // inside a fence: nothing else matters
  }
  if (mathOpen) {
    out += (out.endsWith('\n') ? '' : '\n') + '$$';
  }

  // Half-open inline code: do not attempt any inline repair.
  if (backtickParity === 1) return out;

  const lastLine = out.slice(out.lastIndexOf('\n') + 1);
  const boldOpeners = (lastLine.match(/\*\*/g) ?? []).length;
  if (boldOpeners % 2 === 1) {
    const lastIdx = lastLine.lastIndexOf('**');
    const after = lastLine.slice(lastIdx + 2);
    if (after.trim().length > 0) out += '**';
  }
  return out;
}
