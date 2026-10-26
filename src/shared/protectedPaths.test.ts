import { describe, expect, it } from 'vitest';
import { isProtectedPath } from './protectedPaths';

const roots = ['C:\\Users\\me\\AppData\\Roaming\\Reizo\\data'];

describe('isProtectedPath', () => {
  it('covers the root and everything under it, regardless of slash style or case on Windows', () => {
    expect(isProtectedPath('C:\\Users\\me\\AppData\\Roaming\\Reizo\\data', roots, true)).toBe(true);
    expect(isProtectedPath('c:/users/me/appdata/roaming/reizo/data/reizo.db', roots, true)).toBe(true);
    expect(isProtectedPath('C:\\Users\\me\\AppData\\Roaming\\Reizo\\data\\providers.json', roots, true)).toBe(true);
  });
  it('does not catch siblings that merely share a prefix, or ordinary workspace files', () => {
    expect(isProtectedPath('C:\\Users\\me\\AppData\\Roaming\\Reizo\\data-old\\x', roots, true)).toBe(false);
    expect(isProtectedPath('C:\\Users\\me\\Documents\\notes.md', roots, true)).toBe(false);
  });
  it('is case-sensitive where the file system is', () => {
    expect(isProtectedPath('/home/me/.config/reizo/DATA/x', ['/home/me/.config/reizo/data'], false)).toBe(false);
    expect(isProtectedPath('/home/me/.config/reizo/data/x', ['/home/me/.config/reizo/data'], false)).toBe(true);
  });
  it('ignores empty roots', () => {
    expect(isProtectedPath('/anything', [''], false)).toBe(false);
  });
});
