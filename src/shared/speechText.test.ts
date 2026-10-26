import { describe, expect, it } from 'vitest';
import { chunkForSpeech, markdownToSpeech, speechLang } from './speechText';

describe('markdownToSpeech', () => {
  it('drops code, links\' addresses, images and markup symbols but keeps the words', () => {
    const out = markdownToSpeech('## 标题\n\n- **重点**：见[文档](https://x.test/a)\n\n```js\nconsole.log(1)\n```\n\n用 `npm test` 运行 ![图](a.png) https://raw.url/x');
    expect(out).toContain('标题');
    expect(out).toContain('重点：见文档');
    expect(out).toContain('npm test');
    expect(out).not.toMatch(/console\.log|https?:|\*\*|##|a\.png/);
  });
  it('reads table cells with a pause instead of pipes', () => {
    expect(markdownToSpeech('| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |')).not.toContain('|');
  });
});

describe('chunkForSpeech', () => {
  it('breaks at sentence ends and never exceeds the limit', () => {
    const text = '第一句话。第二句话！第三句话？' + '很长'.repeat(200);
    const chunks = chunkForSpeech(text, 50);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    expect(chunks.join('')).toContain('第二句话');
  });
  it('keeps short text whole and splits at newlines', () => {
    expect(chunkForSpeech('你好。')).toEqual(['你好。']);
    expect(chunkForSpeech('甲\n乙')).toEqual(['甲', '乙']);
    expect(chunkForSpeech('')).toEqual([]);
  });
});

describe('speechLang', () => {
  it('picks the language of the text', () => {
    expect(speechLang('这是一段中文 with a word')).toBe('zh-CN');
    expect(speechLang('This is English only')).toBe('en-US');
    expect(speechLang('1234')).toBe('en-US');
  });
});
