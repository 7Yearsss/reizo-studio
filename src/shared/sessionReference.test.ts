import { describe, expect, it } from 'vitest';
import { digestSession, extractSessionQuery, parseSessionReferences, serializeSessionReference, wrapSessionContext } from './sessionReference';

const msgs = (...pairs: Array<['user' | 'assistant' | 'tool', string]>) => pairs.map(([role, content], i) => ({ id: String(i), role, content, createdAt: '' }));

describe('session references', () => {
  it('opens the picker only for a trailing #word', () => {
    expect(extractSessionQuery('接着 #周报')).toBe('周报');
    expect(extractSessionQuery('#')).toBe('');
    expect(extractSessionQuery('issue#12 done')).toBeNull();
    expect(extractSessionQuery('a #b c')).toBeNull();
  });

  it('round-trips ids, drops malformed ones and caps the count', () => {
    const wire = ['src/a.ts', serializeSessionReference('s-1'), 'session:../etc', serializeSessionReference('s-1'), ...['a', 'b', 'c', 'd', 'e'].map(serializeSessionReference)];
    const { ids, rest } = parseSessionReferences(wire);
    expect(rest).toEqual(['src/a.ts']);
    expect(ids).toEqual(['s-1', 'a', 'b', 'c']);
  });

  it('digest keeps the newest turns within budget and skips tool rows', () => {
    const session = { title: 't', messages: msgs(['user', 'old question'], ['tool', 'noise'], ['assistant', 'x'.repeat(50)], ['user', 'latest']) } as never;
    const full = digestSession(session, 10_000);
    expect(full.text).not.toContain('noise');
    expect(full.omitted).toBe(0);
    const small = digestSession(session, 20);
    expect(small.text).toContain('latest');
    expect(small.omitted).toBeGreaterThan(0);
  });

  it('marks missing sessions and frames content as data', () => {
    const block = wrapSessionContext([{ id: 'gone', missing: true }, { id: 'ok', title: '周报', text: '助手：结论', omitted: 0 }]);
    expect(block).toContain('status="unavailable"');
    expect(block).toContain('read-only background data');
    expect(block).toContain('助手：结论');
  });
});
