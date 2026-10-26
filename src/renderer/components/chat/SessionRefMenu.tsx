import { MessagesSquare } from 'lucide-react';
import { matchAny } from '../../../shared/matchText';
import type { SessionSummary } from '../../../shared/chat';

/** `#` picker: other conversations, matched on title and last message (pinyin-aware like the other menus). */
export default function SessionRefMenu({
  query,
  sessions,
  currentId,
  taken,
  onPick,
}: {
  query: string;
  sessions: SessionSummary[];
  currentId?: string;
  taken: string[];
  onPick: (session: SessionSummary) => void;
}) {
  const hits = sessions
    .filter((s) => s.id !== currentId && !taken.includes(s.id) && (!query || matchAny(query, [s.title, s.listPreview ?? '']) > 0))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);
  if (hits.length === 0) return null;
  return (
    <div className="pop-in absolute right-0 bottom-full left-0 z-50 mb-2 overflow-hidden rounded-2xl border border-line bg-paper-raised py-1 shadow-[0_8px_30px_rgba(28,22,18,0.08)]">
      <div className="px-3 py-0.5 text-[11px] font-semibold text-ink-muted">引用对话</div>
      {hits.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onPick(session)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-inset"
        >
          <MessagesSquare size={13} className="shrink-0 text-accent" />
          <span className="shrink-0 truncate font-medium">{session.title}</span>
          {session.listPreview ? <span className="truncate text-[11px] text-ink-muted">{session.listPreview}</span> : null}
        </button>
      ))}
    </div>
  );
}
