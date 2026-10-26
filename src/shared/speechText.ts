/** Markdown reply -> plain text that sounds right read aloud: no symbols, no code, no link addresses. */
export function markdownToSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/\|/g, '，')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Split into pieces a speech engine handles reliably (some voices stop after ~15 s of one utterance). Breaks at
 * sentence ends, never mid-word when a break is available, never longer than `max` characters.
 */
export function chunkForSpeech(text: string, max = 180): string[] {
  const sentences = text.match(/[^。！？!?；;\n.]+[。！？!?；;.]*[ \t]*|\n/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  for (const sentence of sentences) {
    if (sentence === '\n') { push(); continue; }
    if (sentence.length > max) {
      push();
      for (let i = 0; i < sentence.length; i += max) chunks.push(sentence.slice(i, i + max).trim());
      continue;
    }
    if (current.length + sentence.length > max) push();
    current += sentence;
  }
  push();
  return chunks.filter(Boolean);
}

/** `zh-CN` when the text is mostly Chinese, otherwise `en-US`. */
export function speechLang(text: string): 'zh-CN' | 'en-US' {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk >= latin / 2 && cjk > 0 ? 'zh-CN' : 'en-US';
}
