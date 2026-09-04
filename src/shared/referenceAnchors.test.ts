import { describe, expect, it } from 'vitest';
import { planAnchors, type AnchorRef } from './referenceAnchors';

const char: AnchorRef = {
  id: 'a1',
  role: 'character',
  strength: 'high',
  title: '女主',
  assets: ['c/char.png'],
};
const style: AnchorRef = {
  id: 'a2',
  role: 'style',
  strength: 'mid',
  title: '赛博夜景',
  assets: ['c/style.png'],
};
const content: AnchorRef = {
  id: 'a3',
  role: 'content',
  strength: 'low',
  title: '街角构图',
  assets: ['c/content.png'],
};

describe('planAnchors', () => {
  it('returns empty plan when no anchor has an image', () => {
    expect(planAnchors([{ ...char, assets: [] }])).toEqual({ orderedAssetRefs: [], promptPrefix: '' });
    expect(planAnchors([])).toEqual({ orderedAssetRefs: [], promptPrefix: '' });
  });

  it('numbers a single anchor from the given startIndex', () => {
    const plan = planAnchors([char]);
    expect(plan.orderedAssetRefs).toEqual(['c/char.png']);
    expect(plan.promptPrefix).toContain('<<<image 1>>>');
    expect(plan.promptPrefix).toContain('严格保持完全一致');
  });

  it('orders character → style → content regardless of input order', () => {
    const plan = planAnchors([content, style, char]);
    expect(plan.orderedAssetRefs).toEqual(['c/char.png', 'c/style.png', 'c/content.png']);
    expect(plan.promptPrefix).toMatch(/<<<image 1>>>.*<<<image 2>>>.*<<<image 3>>>/);
  });

  it('offsets placeholder numbers by startIndex', () => {
    const plan = planAnchors([char, style], 3);
    expect(plan.promptPrefix).toContain('<<<image 3>>>');
    expect(plan.promptPrefix).toContain('<<<image 4>>>');
    expect(plan.promptPrefix).not.toContain('<<<image 1>>>');
  });

  it('skips imageless anchors without consuming a number', () => {
    const plan = planAnchors([char, { ...style, assets: [] }, content]);
    expect(plan.orderedAssetRefs).toEqual(['c/char.png', 'c/content.png']);
    expect(plan.promptPrefix).toContain('<<<image 1>>>');
    expect(plan.promptPrefix).toContain('<<<image 2>>>');
    expect(plan.promptPrefix).not.toContain('<<<image 3>>>');
  });

  it('folds a note into the clause', () => {
    const plan = planAnchors([{ ...char, note: '红色风衣' }]);
    expect(plan.promptPrefix).toContain('（红色风衣）');
  });

  it('reflects strength wording per anchor', () => {
    const plan = planAnchors([char, style, content]);
    expect(plan.promptPrefix).toContain('严格保持完全一致'); // high
    expect(plan.promptPrefix).toContain('尽量贴近'); // mid
    expect(plan.promptPrefix).toContain('大致参考'); // low
  });
});
