import { describe, expect, it } from 'vitest';
import { parseCompareTargets } from './compare';

const t = (providerId: string, model: string) => ({ providerId, model });

describe('parseCompareTargets', () => {
  it('accepts two to four distinct targets', () => {
    expect(parseCompareTargets([t('a', 'm1'), t('a', 'm2')])).toHaveLength(2);
    expect(parseCompareTargets([t('a', 'm1'), t('b', 'm1'), t('c', 'm1'), t('d', 'm1')])).toHaveLength(4);
  });
  it('rejects too few, too many, duplicates and malformed entries', () => {
    expect(parseCompareTargets([t('a', 'm1')])).toBeNull();
    expect(parseCompareTargets(Array.from({ length: 5 }, (_, i) => t('a', `m${i}`)))).toBeNull();
    expect(parseCompareTargets([t('a', 'm1'), t('a', 'm1')])).toBeNull();
    expect(parseCompareTargets([t('a', 'm1'), { providerId: 'b' }])).toBeNull();
    expect(parseCompareTargets([t('a', ''), t('b', 'm')])).toBeNull();
    expect(parseCompareTargets('x')).toBeNull();
  });
});
