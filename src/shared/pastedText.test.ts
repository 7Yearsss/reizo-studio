import { describe, expect, it } from 'vitest';
import { LONG_PASTE_CHARS, pastedTextFileName, shouldAttachPastedText } from './pastedText';

describe('pastedText', () => {
  it('only long, non-URL text becomes an attachment', () => {
    expect(shouldAttachPastedText('short')).toBe(false);
    expect(shouldAttachPastedText('a'.repeat(LONG_PASTE_CHARS))).toBe(true);
    expect(shouldAttachPastedText('https://example.com/' + 'a'.repeat(LONG_PASTE_CHARS))).toBe(false);
  });
  it('names the file with a timestamp', () => {
    expect(pastedTextFileName(new Date(2026, 9, 27, 1, 2, 3))).toBe('粘贴文本-1027-010203.txt');
  });
});
