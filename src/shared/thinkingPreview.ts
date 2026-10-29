const HARD = new Set(['。', '！', '？', '!', '?', '；', ';', '\n']);

/** A sentence ends at CJK/ASCII terminators, or at a period followed by whitespace/end ("1.5" stays whole). */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i];
  if (HARD.has(ch)) return true;
  return ch === '.' && (i === text.length - 1 || /\s/.test(text[i + 1]));
}

/**
 * Last *complete* sentence of streaming reasoning text, for the collapsed
 * "thinking" row. A trailing fragment without a terminator is ignored so the
 * row never flickers through half-written words. Returns '' when none yet.
 */
export function lastCompleteSentence(text: string, maxLength = 80): string {
  const trimmed = text.trimEnd();
  let end = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (endsSentence(trimmed, i)) { end = i; break; }
  }
  if (end < 0) return '';
  // A terminator right after another (".\n", "?!") closes the same sentence.
  while (end > 0 && (/\s/.test(trimmed[end]) || (HARD.has(trimmed[end]) && endsSentence(trimmed, end - 1)))) end--;
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (endsSentence(trimmed, i)) { start = i + 1; break; }
  }
  const sentence = trimmed.slice(start, end + 1).replace(/\s+/g, ' ').replace(/^[\s*#>-]+/, '').trim();
  if (!sentence || sentence === trimmed[end]) return '';
  return sentence.length > maxLength ? `…${sentence.slice(sentence.length - maxLength)}` : sentence;
}
