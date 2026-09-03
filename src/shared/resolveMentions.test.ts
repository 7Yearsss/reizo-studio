import { describe, expect, it } from 'vitest';
import { resolveMentions, parseMentionTokens, serializeMention } from './resolveMentions';

describe('resolveMentions', () => {
  const candidates = [
    { id: 'node_alpha_123', label: '女主', assets: ['canvas1/female.png'] },
    { id: 'node_beta_456', label: '女主特写', assets: ['canvas1/female_closeup.png'] },
    { id: 'node_gamma_789', label: '雨夜街道', assets: ['canvas1/rainy_street.png'] },
    { id: 'node_delta_000', label: '空资产节点', assets: [] },
  ];

  it('returns original prompt when no @ mentions exist', () => {
    const prompt = 'A futuristic cyber car in daylight';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe(prompt);
    expect(result.orderedAssetRefs).toEqual([]);
  });

  it('resolves mentions in left-to-right prompt appearance order', () => {
    const prompt = '让 @女主特写 的人物站在 @雨夜街道 之中';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('让 <<<image 1>>> 的人物站在 <<<image 2>>> 之中');
    expect(result.orderedAssetRefs).toEqual(['canvas1/female_closeup.png', 'canvas1/rainy_street.png']);
  });

  it('swapping mention order in prompt swaps the ordered asset refs', () => {
    const prompt = '让 @雨夜街道 背景前出现 @女主特写';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('让 <<<image 1>>> 背景前出现 <<<image 2>>>');
    expect(result.orderedAssetRefs).toEqual(['canvas1/rainy_street.png', 'canvas1/female_closeup.png']);
  });

  it('prefers longest label match over shorter prefix', () => {
    // "女主特写" contains "女主"
    const prompt = '特写画面：@女主特写，全身镜头：@女主';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('特写画面：<<<image 1>>>，全身镜头：<<<image 2>>>');
    expect(result.orderedAssetRefs).toEqual(['canvas1/female_closeup.png', 'canvas1/female.png']);
  });

  it('preserves unmatched @mentions as plain text without fallback', () => {
    const prompt = '参考 @不存在的节点 和 @女主特写';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('参考 @不存在的节点 和 <<<image 1>>>');
    expect(result.orderedAssetRefs).toEqual(['canvas1/female_closeup.png']);
  });

  it('preserves candidate without assets as plain text', () => {
    const prompt = '参考 @空资产节点 和 @女主';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('参考 @空资产节点 和 <<<image 1>>>');
    expect(result.orderedAssetRefs).toEqual(['canvas1/female.png']);
  });

  it('supports node ID prefix matching like @#node_alp or @node_alp', () => {
    const prompt = '根据 @#node_alp 生成画面';
    const result = resolveMentions(prompt, candidates);
    expect(result.resolvedPrompt).toBe('根据 <<<image 1>>> 生成画面');
    expect(result.orderedAssetRefs).toEqual(['canvas1/female.png']);
  });
});

describe('resolveMentions — canonical @[label](canvas:id) syntax', () => {
  const candidates = [
    { id: 'node_alpha_123', label: '女主特写', assets: ['c1/a.png'] },
    { id: 'node_beta_456', label: '雨夜街道', assets: ['c1/b.png'] },
    { id: 'node_empty_000', label: '草稿', assets: [] },
  ];

  it('resolves canonical tokens by id, ignoring a stale cached label', () => {
    const prompt = '让 @[旧标题](canvas:node_alpha_123) 站在 @[雨夜街道](canvas:node_beta_456)';
    const r = resolveMentions(prompt, candidates);
    expect(r.resolvedPrompt).toBe('让 <<<image 1>>> 站在 <<<image 2>>>');
    expect(r.orderedAssetRefs).toEqual(['c1/a.png', 'c1/b.png']);
  });

  it('degrades a canonical mention with no asset to its bare label', () => {
    const prompt = '参考 @[草稿](canvas:node_empty_000) 的构图';
    const r = resolveMentions(prompt, candidates);
    expect(r.resolvedPrompt).toBe('参考 草稿 的构图');
    expect(r.orderedAssetRefs).toEqual([]);
  });

  it('degrades a canonical mention whose node was deleted to its label', () => {
    const prompt = '像 @[已删除](canvas:gone_999) 那样';
    const r = resolveMentions(prompt, candidates);
    expect(r.resolvedPrompt).toBe('像 已删除 那样');
    expect(r.orderedAssetRefs).toEqual([]);
  });

  it('mixes canonical and legacy bare mentions in appearance order', () => {
    const prompt = '@女主特写 与 @[雨夜街道](canvas:node_beta_456)';
    const r = resolveMentions(prompt, candidates);
    expect(r.resolvedPrompt).toBe('<<<image 1>>> 与 <<<image 2>>>');
    expect(r.orderedAssetRefs).toEqual(['c1/a.png', 'c1/b.png']);
  });

  it('offsets <<<image N>>> numbering by startIndex (reference anchors ahead)', () => {
    const prompt = '让 @女主特写 站在 @雨夜街道';
    const r = resolveMentions(prompt, candidates, 3);
    expect(r.resolvedPrompt).toBe('让 <<<image 3>>> 站在 <<<image 4>>>');
    expect(r.orderedAssetRefs).toEqual(['c1/a.png', 'c1/b.png']);
  });

  it('defaults startIndex to 1 (existing callers unchanged)', () => {
    const r = resolveMentions('用 @女主特写 的脸', candidates);
    expect(r.resolvedPrompt).toBe('用 <<<image 1>>> 的脸');
  });
});

describe('parseMentionTokens / serializeMention', () => {
  it('round-trips text and mention tokens', () => {
    const text = 'a @[X](canvas:n1) b @[Y](canvas:n2)';
    const tokens = parseMentionTokens(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'mention', id: 'n1', label: 'X' },
      { type: 'text', value: ' b ' },
      { type: 'mention', id: 'n2', label: 'Y' },
    ]);
  });

  it('serializeMention strips brackets from the label', () => {
    expect(serializeMention('a[b](c)', 'n1')).toBe('@[abc](canvas:n1)');
  });
});
