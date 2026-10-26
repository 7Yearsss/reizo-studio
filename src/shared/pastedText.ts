/** Pastes longer than this become a text attachment instead of flooding the input box. */
export const LONG_PASTE_CHARS = 6000;

export function shouldAttachPastedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < LONG_PASTE_CHARS) return false;
  // A single very long URL is still a link, not a document.
  return !/^https?:\/\/\S+$/i.test(trimmed);
}

export function pastedTextFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `粘贴文本-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;
}
