import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

export default function ChatSearchPanel({
  query,
  onQuery,
  matchCount,
  currentIndex,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  matchCount: number;
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const counter = !query.trim() ? '' : matchCount === 0 ? '0 / 0' : `${currentIndex + 1} / ${matchCount}`;

  return (
    <div
      className="anim-fade absolute top-3 right-4 z-20 flex w-[340px] items-center gap-1.5 rounded-xl border border-line bg-paper-raised px-2 py-1.5 shadow-[0_8px_30px_rgba(28,22,18,0.08)]"
      role="search"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Search size={14} className="shrink-0 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            inputRef.current?.select();
          }
        }}
        placeholder="搜索当前对话"
        aria-label="搜索当前对话"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{counter}</span>
      <div className="mx-0.5 h-4 w-px bg-line" />
      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        title="上一个"
        aria-label="上一个匹配"
        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-paper-inset hover:text-ink disabled:opacity-40"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        title="下一个"
        aria-label="下一个匹配"
        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-paper-inset hover:text-ink disabled:opacity-40"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="关闭"
        aria-label="关闭搜索"
        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-paper-inset hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}
