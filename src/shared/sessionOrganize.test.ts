import { describe, expect, it } from 'vitest';
import type { SessionSummary } from './chat';
import { organizeSessions } from './sessionOrganize';

const s = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({ id, title: id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra });

describe('organizeSessions', () => {
  it('puts pinned first by pin time, archived apart, and leaves the rest in order', () => {
    const out = organizeSessions([
      s('a'),
      s('b', { pinnedAt: '2026-02-01T00:00:00.000Z' }),
      s('c', { pinnedAt: '2026-03-01T00:00:00.000Z' }),
      s('d', { archivedAt: '2026-02-01T00:00:00.000Z' }),
      s('e', { archivedAt: '2026-04-01T00:00:00.000Z' }),
      s('f'),
    ]);
    expect(out.pinned.map((x) => x.id)).toEqual(['c', 'b']);
    expect(out.rest.map((x) => x.id)).toEqual(['a', 'f']);
    expect(out.archived.map((x) => x.id)).toEqual(['e', 'd']);
  });

  it('activity does not move pinned or archived rows; ties fall back to id', () => {
    const t = '2026-02-01T00:00:00.000Z';
    const out = organizeSessions([s('z', { pinnedAt: t, updatedAt: '2026-09-09T00:00:00.000Z' }), s('m', { pinnedAt: t })]);
    expect(out.pinned.map((x) => x.id)).toEqual(['m', 'z']);
  });

  it('an archived session is never shown as pinned', () => {
    const out = organizeSessions([s('x', { pinnedAt: '2026-02-01T00:00:00.000Z', archivedAt: '2026-03-01T00:00:00.000Z' })]);
    expect(out.pinned).toHaveLength(0);
    expect(out.archived).toHaveLength(1);
  });
});
