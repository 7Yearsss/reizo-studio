import { describe, expect, it } from 'vitest';
import { DRAFT_KEY_PREFIX, MAX_DRAFT_CHARS, MAX_DRAFTS, loadDraft, saveDraft, type DraftStorage } from './composerDraft';

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('composerDraft', () => {
  it('round-trips per session and clears on empty text', () => {
    const s = memory();
    saveDraft(s, 'a', 'hello');
    saveDraft(s, 'b', 'world');
    expect(loadDraft(s, 'a')).toBe('hello');
    saveDraft(s, 'a', '  ');
    expect(loadDraft(s, 'a')).toBe('');
    expect(loadDraft(s, 'b')).toBe('world');
  });

  it('caps length and evicts the oldest drafts', () => {
    const s = memory();
    saveDraft(s, 'long', 'x'.repeat(MAX_DRAFT_CHARS + 5));
    expect(loadDraft(s, 'long')).toHaveLength(MAX_DRAFT_CHARS);
    for (let i = 0; i < MAX_DRAFTS; i++) saveDraft(s, `s${i}`, 't');
    expect(s.getItem(DRAFT_KEY_PREFIX + 'long')).toBeNull();
    expect(loadDraft(s, `s${MAX_DRAFTS - 1}`)).toBe('t');
  });

  it('survives a throwing storage', () => {
    const bad: DraftStorage = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(() => saveDraft(bad, 'a', 'b')).not.toThrow();
    expect(loadDraft(bad, 'a')).toBe('');
  });
});
