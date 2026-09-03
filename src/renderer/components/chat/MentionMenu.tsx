import { useEffect, useState } from 'react';
import { File, Folder, ImageIcon, Video, Bot } from 'lucide-react';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';
import type { CanvasNode } from '../../../shared/canvas';
import { useCanvasStore } from '../../state/useCanvasStore';

export function extractMentionQuery(text: string): string | null {
  const match = text.match(/@([^\s@]*)$/);
  return match ? match[1] : null;
}

export default function MentionMenu({
  query,
  sessionId,
  onPick,
  onPickNode,
}: {
  query: string;
  sessionId?: string;
  onPick: (relativePath: string) => void;
  onPickNode?: (node: CanvasNode) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const storeNodes = useCanvasStore((s) => (sessionId ? s.nodesBySession[sessionId] : undefined)) ?? [];

  const matchedNodes = sessionId
    ? storeNodes
        .filter((n) => {
          const q = query.toLowerCase();
          const p = (n.params as Record<string, string>) || {};
          const txt = `${n.title} ${p.prompt || ''} ${p.instruction || ''} ${n.type}`.toLowerCase();
          return txt.includes(q);
        })
        .slice(0, 4)
    : [];

  useEffect(() => {
    let cancelled = false;
    void api
      .flattenWorkspace()
      .then((all) => {
        if (cancelled) return;
        const q = query.toLowerCase();
        setEntries(all.filter((e) => e.relativePath.toLowerCase().includes(q)).slice(0, 10));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (entries.length === 0 && matchedNodes.length === 0) return null;

  return (
    <div className="pop-in absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-[0_8px_30px_rgba(28,22,18,0.08)] z-50">
      {matchedNodes.length > 0 ? (
        <div className="border-b border-line bg-paper-inset/30 py-1">
          <div className="px-3 py-0.5 text-[10px] font-semibold text-ink-muted">画布节点引用</div>
          {matchedNodes.map((node) => {
            const p = (node.params as Record<string, string>) || {};
            const desc = p.prompt || p.instruction || '';
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onPickNode?.(node)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-inset"
              >
                {node.type === 'image' ? (
                  <ImageIcon size={13} className="text-accent shrink-0" />
                ) : node.type === 'video' ? (
                  <Video size={13} className="text-accent shrink-0" />
                ) : (
                  <Bot size={13} className="text-accent shrink-0" />
                )}
                <span className="font-medium text-ink truncate">
                  {node.title || (node.type === 'image' ? '图片节点' : node.type === 'video' ? '视频节点' : 'Agent任务')}
                </span>
                {desc ? <span className="truncate text-ink-muted text-[11px]">“{desc}”</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

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
