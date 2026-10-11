import { describe, expect, it } from 'vitest';
import { checkDocument, type CheckBlock } from './documentChecks';

const blocks = (...texts: string[]): CheckBlock[] => texts.map((text, i) => ({ id: `b${i}`, type: 'paragraph', text }));
const kinds = (list: CheckBlock[], options?: Parameters<typeof checkDocument>[1]) => checkDocument(list, options).findings.map((f) => [f.kind, f.blockId, f.text, f.replacement]);

describe('checkDocument', () => {
  it('finds skipped, repeated and backwards numbering but not restarted lists', () => {
    const found = checkDocument(blocks('一、背景', '二、目标', '四、计划', '（一）范围', '（二）人员', '五、总结', '（一）收尾')).findings.filter((f) => f.kind === 'numbering');
    expect(found.map((f) => [f.text, f.message.includes('应为')])).toEqual([['四、', true]]);
    expect(found[0].message).toContain('应为 3');
    const dup = checkDocument(blocks('1. 甲', '2. 乙', '2. 丙')).findings.filter((f) => f.kind === 'numbering');
    expect(dup).toHaveLength(1);
    expect(checkDocument(blocks('1. 甲', '2. 乙', '正文', '1. 丙', '2. 丁')).findings.filter((f) => f.kind === 'numbering')).toHaveLength(0);
  });

  it('flags half-width punctuation inside Chinese sentences with the fix', () => {
    expect(kinds(blocks('本次会议讨论预算,人员,进度。'))).toEqual([['punctuation', 'b0', ',', '，'], ['punctuation', 'b0', ',', '，']]);
    expect(kinds(blocks('请见附件(第三页)说明。'))).toContainEqual(['punctuation', 'b0', '(第三页)', '（第三页）']);
    // English text and times are left alone.
    expect(kinds(blocks('Hello, world: nothing to fix here.', '会议时间为上午10:30开始'))).toEqual([]);
  });

  it('reports the minority date and number formats against the dominant one', () => {
    const found = checkDocument(blocks('2025年3月1日签署', '2025年4月2日生效', '截止 2025-05-06', '金额 12,000 元', '另有 3,500 元', '合计 15500 元')).findings;
    expect(found.filter((f) => f.kind === 'date-format').map((f) => f.text)).toEqual(['2025-05-06']);
    expect(found.filter((f) => f.kind === 'number-format').map((f) => [f.text, f.replacement])).toEqual([['15500', '15,500']]);
  });

  it('finds stray spaces, doubled function words and repeated paragraphs, and applies a glossary', () => {
    const long = '这是一段足够长的相同内容，用来检查重复段落，并且确保长度超过阈值。';
    const list = blocks('  段首空格', '段尾空格  ', '这是的的错误', long, long, '用户登录后使用者可以查看');
    const found = checkDocument(list, { terms: [{ preferred: '用户', variants: ['使用者'] }] }).findings;
    expect(found.map((f) => f.kind)).toEqual(['spacing', 'spacing', 'repeated-word', 'repeated-paragraph', 'term']);
    expect(found.find((f) => f.kind === 'term')).toMatchObject({ text: '使用者', replacement: '用户' });
    expect(found.find((f) => f.kind === 'repeated-word')).toMatchObject({ text: '的的', replacement: '的' });
  });

  it('caps the list but still reports the total', () => {
    const many = blocks(...Array.from({ length: 30 }, () => '甲乙丙丁,戊己庚辛,'));
    const result = checkDocument(many, { max: 10 });
    expect(result.findings).toHaveLength(10);
    expect(result.total).toBe(60);
    expect(result.counts.punctuation).toBe(60);
  });
});
