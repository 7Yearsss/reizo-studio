import { useState } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import { HighlightedText } from '../../lib/highlightText';

export default function UserMessage({
  content,
  searchQuery,
  currentMatch = false,
  canEdit = false,
  onEdit,
}: {
  content: string;
  searchQuery?: string;
  currentMatch?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div
      className={`anim-msg group flex justify-end ${currentMatch ? 'chat-search-current' : ''}`}
    >
      <div className="max-w-[75%]">
        <div className="whitespace-pre-wrap rounded-[22px] border border-line bg-paper-raised px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          <HighlightedText text={content} query={searchQuery} />
        </div>
        <div className="mt-1 flex justify-end gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
            >
              <Pencil size={11} />
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
}
