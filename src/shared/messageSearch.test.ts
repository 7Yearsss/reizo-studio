import { describe, expect, it } from 'vitest';
import { likePattern, makeSnippet, searchTerms } from './messageSearch';

describe('messageSearch', () => {
  it('splits terms, dedupes and caps them', () => {
    expect(searchTerms('  报销  流程 报销 ')).toEqual(['报销', '流程']);
    expect(searchTerms('a b c d e f g')).toHaveLength(5);
    expect(searchTerms('   ')).toEqual([]);
  });
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('windows the snippet around the earliest match', () => {
    const text = `${'前文'.repeat(60)}报销流程说明${'后文'.repeat(60)}`;
    const s = makeSnippet(text, ['流程', '报销']);
    expect(s).toContain('报销流程');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(makeSnippet('短文本', ['没有'])).toBe('短文本');
  });
});
