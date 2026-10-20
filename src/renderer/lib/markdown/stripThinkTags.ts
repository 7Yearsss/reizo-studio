/**
 * Hides inline `<think>` reasoning in a reply. New turns are cleaned server-side; this covers messages
 * already stored with the tags, and a block still streaming in. Fenced code is left alone so a reply that
 * documents the tags keeps them.
 *
 *   `<think>a\n<think>b\n</think>answer`  ->  `answer`   (everything up to the last closing tag is reasoning)
 *   `answer<think>still thinking…`        ->  `answer`   (an unclosed block runs to the end)
 */
const FENCE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const OPEN = '<think>';
const CLOSE = '</think>';
// Private-use characters never appear in model output; they bracket a parked fence's index.
const MARK = String.fromCharCode(0xe000);
const PARKED = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

export function stripThinkTags(markdown: string): string {
  if (!markdown.includes('think>')) return markdown;
  // Park fenced code behind placeholders so tags inside it are neither matched nor removed.
  const fences: string[] = [];
  const parked = markdown.replace(FENCE, (fence) => `${MARK}${fences.push(fence) - 1}${MARK}`);
  if (!parked.includes('think>')) return markdown;

  const close = parked.lastIndexOf(CLOSE);
  const afterClose = close >= 0 ? parked.slice(close + CLOSE.length) : parked;
  const open = afterClose.indexOf(OPEN);
  const visible = (open >= 0 ? afterClose.slice(0, open) : afterClose).replace(/^\s*\n/, '');

  return visible.replace(PARKED, (_, index: string) => fences[Number(index)] ?? '');
}
