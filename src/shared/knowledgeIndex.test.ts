import { describe, expect, it } from 'vitest';
import { buildIndex, chunkText, tokenize } from './knowledgeIndex';

describe('tokenize', () => {
  it('keeps Latin words and splits Chinese into overlapping pairs', () => {
    expect(tokenize('Refund policy 退款政策')).toEqual(['refund', 'policy', '退款', '款政', '政策']);
    expect(tokenize('a 好 b')).toEqual(['a', '好', 'b']);
  });
});

describe('chunkText', () => {
  it('follows paragraphs, keeps passages bounded, and numbers them', () => {
    const text = Array.from({ length: 6 }, (_, i) => `第${i}段。${'内容'.repeat(150)}`).join('\n\n');
    const chunks = chunkText('d1', text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 1200 && c.docId === 'd1')).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });
  it('cuts one very long paragraph at sentence ends', () => {
    const chunks = chunkText('d', `${'这是一句话。'.repeat(400)}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.endsWith('。')).toBe(true);
  });
  it('returns nothing for empty text', () => {
    expect(chunkText('d', '  \n\n ')).toEqual([]);
  });
});

describe('buildIndex', () => {
  const index = buildIndex([
    ...chunkText('policy.md', '退款政策：商品签收后七天内可以申请退款，需保持包装完好。'),
    ...chunkText('shipping.md', '发货说明：下单后48小时内发货，默认使用顺丰快递。'),
    ...chunkText('brand.md', 'Brand voice: friendly, concise, never use exclamation marks.'),
  ]);
  it('ranks the passage that actually contains the query terms first', () => {
    expect(index.search('怎么申请退款')[0].docId).toBe('policy.md');
    expect(index.search('快递 发货')[0].docId).toBe('shipping.md');
    expect(index.search('brand voice')[0].docId).toBe('brand.md');
  });
  it('returns nothing when no term matches, and respects the limit', () => {
    expect(index.search('量子计算')).toEqual([]);
    expect(index.search('退款 发货 voice', 2).length).toBeLessThanOrEqual(2);
    expect(buildIndex([]).search('x')).toEqual([]);
  });
});
