/**
 * Turns `Sheet1!C5` / `'月度 数据'!A2:B9` in a reply into links the chat can open in the Excel panel.
 * Only sheet-qualified addresses qualify: a bare "C5" in prose is too likely to mean something else.
 */
// A hash-only href: it passes the markdown link sanitizer, which blocks unknown protocols.
export const SHEET_CELL_SCHEME = '#sheetcell:';

const NAME = /(?:'(?:[^']|'')+'|[\w一-鿿-]{1,40})/.source;
const CELL = /\$?[A-Z]{1,3}\$?\d{1,5}/.source;
const TICK = '`';
const ADDRESS = new RegExp(`(${TICK}?)(?<![\\w/.:'])(${NAME})!(${CELL}(?::${CELL})?)(?![\\w(])\\1`, 'g');
const FENCE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/;

export function linkSheetCells(markdown: string): string {
  return markdown.split(FENCE).map((part, index) => (index % 2 ? part : part.replace(ADDRESS, (_whole, tick: string, name: string, range: string) => {
    const sheet = name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;
    const label = `${name}!${range}`;
    return `[${tick ? `${TICK}${label}${TICK}` : label}](${SHEET_CELL_SCHEME}${encodeURIComponent(sheet)}!${range.replace(/\$/g, '')})`;
  }))).join('');
}

export function parseSheetCellHref(href: string): { sheetName: string; range: string } | null {
  if (!href.startsWith(SHEET_CELL_SCHEME)) return null;
  const rest = href.slice(SHEET_CELL_SCHEME.length);
  const bang = rest.lastIndexOf('!');
  if (bang < 1) return null;
  try { return { sheetName: decodeURIComponent(rest.slice(0, bang)), range: rest.slice(bang + 1) }; } catch { return null; }
}
