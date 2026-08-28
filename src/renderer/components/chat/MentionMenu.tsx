import { useEffect, useState } from 'react';
import { File, Folder } from 'lucide-react';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';

export function extractMentionQuery(text: string): string | null {
  const match = text.match(/@([^\s@]*)$/);
  return match ? match[1] : null;
}

export default function MentionMenu({
  query,
  onPick,
}: {
  query: string;
  onPick: (relativePath: string) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .flattenWorkspace()
      .then((all) => {
        if (cancelled) return;
        const q = query.toLowerCase();
        setEntries(all.filter((e) => e.relativePath.toLowerCase().includes(q)).slice(0, 12));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (entries.length === 0) return null;

  return (
    <div className="pop-in absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-[0_8px_30px_rgba(28,22,18,0.08)]">
      {entries.map((entry) => (
        <button
          key={entry.relativePath}
          type="button"
          onClick={() => onPick(entry.relativePath)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-paper-inset/70"
        >
          {entry.kind === 'dir' ? (
            <Folder size={14} className="shrink-0 text-ink-muted" />
          ) : (
            <File size={14} className="shrink-0 text-ink-muted" />
          )}
          <span className="truncate">{entry.relativePath}</span>
        </button>
      ))}
    </div>
  );
}
