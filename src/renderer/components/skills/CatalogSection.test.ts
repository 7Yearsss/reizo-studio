import { describe, expect, it } from 'vitest';
import { freeServerName } from './CatalogSection';

describe('freeServerName', () => {
  it('keeps a free name and numbers a taken one', () => {
    expect(freeServerName('github', new Set())).toBe('github');
    expect(freeServerName('github', new Set(['github']))).toBe('github-2');
    expect(freeServerName('github', new Set(['github', 'github-2']))).toBe('github-3');
  });
  it('stays inside the 24-character limit when numbering a long name', () => {
    const long = 'a'.repeat(24);
    const next = freeServerName(long, new Set([long]));
    expect(next).toHaveLength(24);
    expect(next.endsWith('-2')).toBe(true);
  });
});
