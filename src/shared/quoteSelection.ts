export const QUOTE_SELECTION_EVENT = 'reizo:quote-selection';
export const MAX_QUOTE_CHARS = 2000;

/** Selected conversation text as a markdown blockquote, ready to sit above the user's follow-up. */
export function formatQuote(selection: string): string {
  const text = selection.replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  const clipped = text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : text;
  return `${clipped.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n')}\n\n`;
}

/** Add a quote to an existing draft without gluing it to the previous line. */
export function appendQuote(draft: string, quote: string): string {
  if (!quote) return draft;
  if (!draft.trim()) return quote;
  return `${draft.replace(/\s+$/, '')}\n\n${quote}`;
}
