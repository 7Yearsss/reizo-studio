import { RotateCcw } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import ToolCard from './ToolCard';
import ThinkingCard from './ThinkingCard';
import MarkdownContent, { CopyButton } from './MarkdownContent';

function StreamingCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-0.5 animate-pulse rounded-sm bg-accent align-text-bottom"
      aria-hidden
    />
  );
}

export default function AssistantMessage({
  content,
  parts,
  reasoning,
  reasoningStreaming = false,
  reasoningStartedAt,
  reasoningMs,
  streaming = false,
  currentMatch = false,
  canRetry = false,
  onRetry,
}: {
  content: string;
  parts?: ToolCallPart[];
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningStartedAt?: number;
  reasoningMs?: number;
  streaming?: boolean;
  currentMatch?: boolean;
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`anim-msg group space-y-3 ${currentMatch ? 'chat-search-current' : ''}`}>
      {(reasoning || reasoningStreaming) && (
        <ThinkingCard
          content={reasoning ?? ''}
          streaming={reasoningStreaming}
          startedAt={reasoningStartedAt}
          durationMs={reasoningMs}
        />
      )}
      {parts?.map((part) => (
        <ToolCard key={part.id} part={part} />
      ))}
      <div className="markdown text-[15px] leading-[1.75] text-ink">
        {content ? (
          <>
            <MarkdownContent content={content} streaming={streaming} />
            {streaming && <StreamingCaret />}
          </>
        ) : streaming && !parts?.length ? (
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <StreamingCaret />
            <span className="text-[12px]">正在回复</span>
          </span>
        ) : null}
      </div>
      {content && !streaming && (
        <div className="flex gap-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton
            text={content}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          />
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
            >
              <RotateCcw size={11} />
              重新生成
            </button>
          )}
        </div>
      )}
    </div>
  );
}
