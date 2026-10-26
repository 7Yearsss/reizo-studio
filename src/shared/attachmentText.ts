/** How much of an attached text file goes straight into the prompt. The rest is read on demand. */
export const ATTACHMENT_INLINE_LIMIT = 20_000;
export const ATTACHMENT_PAGE_DEFAULT = 20_000;
export const ATTACHMENT_PAGE_MAX = 40_000;

/** The attachment as it appears in the prompt; a cut is always announced, with the exact call that reads the rest. */
export function inlineAttachment(name: string, content: string, limit = ATTACHMENT_INLINE_LIMIT): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n[已截断：显示 ${limit} / 共 ${content.length} 字符。调用 read_attachment(name=${JSON.stringify(name)}, offset=${limit}) 读取后续内容]`;
}

export interface AttachmentPage {
  text: string;
  offset: number;
  end: number;
  total: number;
  /** The offset to ask for next, or null when this page reaches the end. */
  nextOffset: number | null;
}

/** One page of an attachment. Out-of-range or fractional input is clamped rather than rejected. */
export function pageAttachment(content: string, offset = 0, length = ATTACHMENT_PAGE_DEFAULT): AttachmentPage {
  const total = content.length;
  const start = Math.min(Math.max(Number.isFinite(offset) ? Math.floor(offset) : 0, 0), total);
  const size = Math.min(Math.max(Number.isFinite(length) ? Math.floor(length) : ATTACHMENT_PAGE_DEFAULT, 1), ATTACHMENT_PAGE_MAX);
  const end = Math.min(start + size, total);
  return { text: content.slice(start, end), offset: start, end, total, nextOffset: end < total ? end : null };
}
