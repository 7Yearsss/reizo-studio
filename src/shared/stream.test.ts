import { describe, expect, it } from 'vitest';
import { buildFileDiffPreview, FILE_DIFF_PREVIEW_MAX_CHARS } from './stream';

describe('buildFileDiffPreview', () => {
  it('passes small before/after through untouched', () => {
    const preview = buildFileDiffPreview('src/a.ts', 'old\n', 'new\n');
    expect(preview).toEqual({ path: 'src/a.ts', before: 'old\n', after: 'new\n' });
    expect(preview.truncated).toBeUndefined();
  });

  it('clamps an oversized side and flags it truncated', () => {
    const huge = 'x'.repeat(FILE_DIFF_PREVIEW_MAX_CHARS + 500);
    const preview = buildFileDiffPreview('big.txt', '', huge, 100);
    expect(preview.before).toBe('');
    expect(preview.after).toHaveLength(100);
    expect(preview.truncated).toBe(true);
  });

  it('treats an empty before as a file creation', () => {
    const preview = buildFileDiffPreview('new.md', '', '# hi');
    expect(preview.before).toBe('');
    expect(preview.after).toBe('# hi');
  });
});
