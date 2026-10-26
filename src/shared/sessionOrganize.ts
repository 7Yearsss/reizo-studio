import type { SessionSummary } from './chat';

export interface OrganizedSessions {
  /** Pinned, newest pin first. */
  pinned: SessionSummary[];
  /** Everything else, in the order given. */
  rest: SessionSummary[];
  /** Archived, most recently archived first; ties broken by id so the order never shuffles. */
  archived: SessionSummary[];
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Split a session list for the sidebar. Opening or chatting never reorders pinned/archived rows: they sort on
 * the time they were pinned/archived, not on activity. An archived session is never also shown as pinned.
 */
export function organizeSessions(sessions: readonly SessionSummary[]): OrganizedSessions {
  const pinned: SessionSummary[] = [];
  const rest: SessionSummary[] = [];
  const archived: SessionSummary[] = [];
  for (const session of sessions) {
    if (session.archivedAt) archived.push(session);
    else if (session.pinnedAt) pinned.push(session);
    else rest.push(session);
  }
  pinned.sort((a, b) => time(b.pinnedAt) - time(a.pinnedAt) || a.id.localeCompare(b.id));
  archived.sort((a, b) => time(b.archivedAt) - time(a.archivedAt) || a.id.localeCompare(b.id));
  return { pinned, rest, archived };
}
