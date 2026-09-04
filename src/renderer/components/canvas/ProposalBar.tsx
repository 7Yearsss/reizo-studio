import React, { useEffect, useState } from 'react';
import { Sparkles, Check, X, Eye } from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';

export interface ProposalBarProps {
  sessionId: string;
  onFocusProposals: (nodeIds: string[]) => void;
}

export default function ProposalBar({ sessionId, onFocusProposals }: ProposalBarProps) {
  const proposalIds = useCanvasStore((s) => s.proposalsBySession[sessionId] ?? []);
  const count = proposalIds.length;
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    if (count === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void canvasStore.acceptProposals(sessionId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void canvasStore.rejectProposals(sessionId);
      } else if (e.key === ' ' && !e.ctrlKey) {
        e.preventDefault();
        if (proposalIds.length > 0) {
          const nextIdx = (focusIdx + 1) % proposalIds.length;
          setFocusIdx(nextIdx);
          onFocusProposals([proposalIds[nextIdx]]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionId, count, proposalIds, focusIdx, onFocusProposals]);

  if (count === 0) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-accent/40 bg-paper-raised/95 px-4 py-2 text-xs shadow-2xl backdrop-blur-xl ring-2 ring-accent/20 select-none">
      <div className="flex items-center gap-1.5 font-medium text-ink">
        <Sparkles size={14} className="text-accent animate-pulse" />
        <span>Agent 提案了 <strong className="text-accent font-semibold">{count}</strong> 个变更节点</span>
      </div>

      <div className="h-3.5 w-px bg-line" aria-hidden />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (proposalIds.length > 0) {
              const nextIdx = (focusIdx + 1) % proposalIds.length;
              setFocusIdx(nextIdx);
              onFocusProposals([proposalIds[nextIdx]]);
            }
          }}
          className="flex items-center gap-1 rounded-xl border border-line/70 bg-paper-inset/40 px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper-inset/80 active:scale-95 transition-all"
          title="空格键依次聚焦查看提案节点"
        >
          <Eye size={12} className="text-accent" />
          空间走查 (Space)
        </button>

        <button
          type="button"
          onClick={() => void canvasStore.acceptProposals(sessionId)}
          className="flex items-center gap-1 rounded-xl bg-accent text-accent-ink px-3 py-1 text-xs font-semibold shadow-xs hover:opacity-90 active:scale-95 transition-all"
          title="回车键确认接受全部提案"
        >
          <Check size={12} strokeWidth={2.5} />
          全部接受 (Enter)
        </button>

        <button
          type="button"
          onClick={() => void canvasStore.rejectProposals(sessionId)}
          className="flex items-center gap-1 rounded-xl border border-line/70 px-2 py-1 text-xs text-ink-muted hover:text-danger hover:border-danger/30 hover:bg-danger/10 active:scale-95 transition-all"
          title="Esc 键放弃全部提案"
        >
          <X size={12} />
          放弃 (Esc)
        </button>
      </div>
    </div>
  );
}
