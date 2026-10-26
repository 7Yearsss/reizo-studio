import { describe, expect, it } from 'vitest';
import { splitBarePaths, workspaceFileHref, workspaceFilePath } from './workspaceFileLinks';

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

describe('splitBarePaths', () => {
  const paths = (text: string) => splitBarePaths(text).filter((p) => p.path).map((p) => p.path);
  it('finds relative, absolute and Windows paths in prose, next to Chinese text', () => {
    expect(paths('已修改 src/main/index.ts 和 docs/a.md。')).toEqual(['src/main/index.ts', 'docs/a.md']);
    expect(paths('文件在C:\\work\\报告.docx里')).toEqual(['C:/work/报告.docx']);
    expect(paths('见 ./out/result.xlsx:12')).toEqual(['./out/result.xlsx']);
    expect(paths('打开report.pdf看看')).toEqual(['report.pdf']);
  });
  it('leaves URLs, emails and plain prose alone', () => {
    expect(paths('访问 https://example.com/docs/a.html 或 mail me@site.md')).toEqual([]);
    expect(paths('e.g. this and v1.2 are fine')).toEqual([]);
  });
});
