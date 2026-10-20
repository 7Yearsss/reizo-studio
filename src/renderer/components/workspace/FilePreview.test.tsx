import { describe, expect, it } from 'vitest';
import { previewKind } from './FilePreview';

describe('previewKind', () => {
  it('renders Markdown and HTML files, shows everything else as code', () => {
    expect(previewKind('docs/readme.md')).toBe('markdown');
    expect(previewKind('a/B.MARKDOWN')).toBe('markdown');
    expect(previewKind('site/index.html')).toBe('html');
    expect(previewKind('site/page.HTM')).toBe('html');
    expect(previewKind('src/app.ts')).toBe('code');
    expect(previewKind('notes.md.bak')).toBe('code');
  });
});
