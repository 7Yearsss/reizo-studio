export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export interface HtmlEdit { oldText: string; newText: string }
export interface HtmlSelection { start: number; end: number; text?: string }
export function validateHtmlContent(content: string): string {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > MAX_HTML_BYTES) throw new Error('HTML 文件需小于 2 MB');
  if (content.includes('\0')) throw new Error('文件包含二进制内容，请导入 UTF-8 HTML');
  return content;
}
export function htmlEditRange(content: string, edit: HtmlEdit): { start: number; end: number } {
  if (!edit.oldText || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') throw new Error('修改需要非空 oldText 和 newText 字符串');
  const start = content.indexOf(edit.oldText);
  if (start < 0 || content.indexOf(edit.oldText, start + 1) >= 0) throw new Error('oldText 必须在当前 HTML 中精确且唯一匹配；请读取更多上下文');
  return { start, end: start + edit.oldText.length };
}
export function applyHtmlEdits(content: string, edits: HtmlEdit[], selection?: HtmlSelection): string {
  const ranges = edits.map((edit) => ({ ...htmlEditRange(content, edit), edit }));
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (i && ranges[i - 1].end > range.start) throw new Error('修改范围重叠，请合并为一项建议');
    if (selection && (range.start < selection.start || range.end > selection.end)) throw new Error('修改超出引用的源码选区');
  }
  let next = content;
  for (const range of ranges.reverse()) next = next.slice(0, range.start) + range.edit.newText + next.slice(range.end);
  return validateHtmlContent(next);
}
export const EMPTY_HTML = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>新页面</title>\n  <style>body { font-family: system-ui; max-width: 800px; margin: 64px auto; padding: 24px; }</style>\n</head>\n<body>\n  <h1>开始创作</h1>\n  <p>在这里编辑内容，或让 AI 提出修改建议。</p>\n</body>\n</html>\n';
