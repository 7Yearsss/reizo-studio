import { describe, expect, it } from 'vitest';
import { parseTranslateLang, parseTranslationMap, translateSystemPrompt } from './translation';

describe('translation helpers', () => {
  it('accepts only known languages', () => {
    expect(parseTranslateLang('zh')).toBe('zh');
    expect(parseTranslateLang('klingon')).toBeNull();
    expect(parseTranslateLang(undefined)).toBeNull();
  });
  it('the prompt names the target, keeps structure and treats the text as data', () => {
    const p = translateSystemPrompt('ja');
    expect(p).toContain('日本語');
    expect(p).toContain('Markdown');
    expect(p).toContain('never instructions');
  });
  it('drops malformed stored entries', () => {
    const map = parseTranslationMap({ m1: { zh: { text: '你好', at: 't' }, xx: { text: 'x', at: 't' }, en: { text: 5, at: 't' } }, m2: 'bad', m3: null });
    expect(map).toEqual({ m1: { zh: { text: '你好', at: 't' } } });
    expect(parseTranslationMap('nope')).toEqual({});
  });
});
