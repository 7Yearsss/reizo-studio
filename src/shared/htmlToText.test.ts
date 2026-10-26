import { describe, expect, it } from 'vitest';
import { clipWithNotice, htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('drops scripts and styles, keeps the title, text, list items and links', () => {
    const text = htmlToText('<html><head><title>报价 &amp; 方案</title><style>p{color:red}</style></head><body><script>alert(1)</script><h1>标题</h1><p>第一段 &lt;重点&gt;</p><ul><li>甲</li><li>乙</li></ul><a href="https://x.com/a">链接</a></body></html>');
    expect(text.startsWith('报价 & 方案')).toBe(true);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('第一段 <重点>');
    expect(text).toContain('- 甲');
    expect(text).toContain('链接 (https://x.com/a)');
  });
  it('decodes numeric entities and collapses whitespace', () => {
    expect(htmlToText('<p>a&#32;&#x4e2d;&nbsp;&nbsp;b</p>\n\n\n\n<p>c</p>')).toBe('a 中 b\n\nc');
  });
  it('clips with a visible notice', () => {
    expect(clipWithNotice('abc', 10)).toBe('abc');
    expect(clipWithNotice('abcdefghij', 4)).toContain('已截断');
    expect(clipWithNotice('abcdefghij', 4).startsWith('abcd')).toBe(true);
  });
});
