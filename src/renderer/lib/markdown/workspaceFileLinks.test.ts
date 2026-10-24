import { describe, expect, it } from 'vitest';
import { workspaceFileHref, workspaceFilePath } from './workspaceFileLinks';

describe('workspace file destinations', () => {
  it('handles Windows paths, file URLs, line suffixes and encoded Chinese filenames', () => {
    expect(workspaceFilePath('F:\\作品\\封面.png')).toBe('F:/作品/封面.png');
    expect(workspaceFilePath('file:///F:/%E4%BD%9C%E5%93%81/cover.png')).toBe('F:/作品/cover.png');
    expect(workspaceFilePath('src/main.ts:12:4')).toBe('src/main.ts');
    expect(workspaceFilePath('src/main.ts#L12')).toBe('src/main.ts');
    expect(workspaceFilePath(workspaceFileHref('out/100%.md'))).toBe('out/100%.md');
  });
  it('leaves web, canvas, sheet and executable URLs out of the local preview handler', () => {
    for (const url of ['https://example.com/clip.mp4', 'canvas:node-1', '#sheetcell:Sheet1!C5', 'javascript:evil.md', '//server/cover.png', 'file://server/cover.png']) {
      expect(workspaceFilePath(url)).toBeNull();
    }
  });
});
