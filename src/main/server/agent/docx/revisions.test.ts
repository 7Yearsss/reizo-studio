import { describe, expect, it } from 'vitest';
import { diffText } from './revisions';

const apply = (ops: ReturnType<typeof diffText>, keep: 'before' | 'after') => ops.filter((o) => o.op === 'eq' || o.op === (keep === 'before' ? 'del' : 'ins')).map((o) => o.text).join('');

describe('diffText', () => {
  it('reconstructs both sides exactly', () => {
    for (const [a, b] of [['项目预计十月上线。', '项目预计十一月上线。'], ['Hello big world', 'Hello brave new world!'], ['', '新增'], ['删除', ''], ['same', 'same'], ['甲乙丙丁戊己', '丁戊己甲乙丙']] as const) {
      const ops = diffText(a, b);
      expect(apply(ops, 'before')).toBe(a);
      expect(apply(ops, 'after')).toBe(b);
    }
  });
  it('shows a small edit as a small change', () => {
    expect(diffText('项目预计十月上线。', '项目预计十一月上线。')).toEqual([
      { op: 'eq', text: '项目预计十' }, { op: 'ins', text: '一' }, { op: 'eq', text: '月上线。' },
    ]);
    expect(diffText('Hello big world', 'Hello brave world')).toEqual([
      { op: 'eq', text: 'Hello ' }, { op: 'del', text: 'big' }, { op: 'ins', text: 'brave' }, { op: 'eq', text: ' world' },
    ]);
  });
  it('folds a one-character island between two changes', () => {
    const ops = diffText('甲X乙', '丙X丁');
    expect(ops.some((o) => o.op === 'eq')).toBe(false);
  });
});
