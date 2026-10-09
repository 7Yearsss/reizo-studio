import { describe, expect, it } from 'vitest';
import { isReferenceLabel, labelSelections } from './referenceLabels';

describe('labelSelections', () => {
  it('numbers only picked ranges, in order, from the given start', () => {
    const refs = [{ id: 'a', selection: 1 }, { id: 'b' }, { id: 'c', selection: 2, label: 9 }];
    expect(labelSelections(refs, 3)).toEqual([{ id: 'a', selection: 1, label: 3 }, { id: 'b' }, { id: 'c', selection: 2, label: 4 }]);
  });
  it('drops a stale label from a whole-file reference', () => {
    expect(labelSelections([{ id: 'a', label: 2 }])).toEqual([{ id: 'a' }]);
  });
  it('accepts small positive integers only', () => {
    expect([1, 99].every(isReferenceLabel)).toBe(true);
    expect([0, 100, 1.5, '1', undefined].some(isReferenceLabel)).toBe(false);
  });
});
