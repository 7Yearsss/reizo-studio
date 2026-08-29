import { RotateCcw } from 'lucide-react';
import type { ReplyActivity, ToolCallPart } from '../../../shared/chat';
import MarkdownContent, { CopyButton } from './MarkdownContent';
import WorkGroupCard from './WorkGroupCard';

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
  durationMs,
  streaming = false,
  currentMatch = false,
  canRetry = false,
  onRetry,
  activities,
}: {
  content: string;
  parts?: ToolCallPart[];
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningStartedAt?: number;
  reasoningMs?: number;
  durationMs?: number;
  streaming?: boolean;
  currentMatch?: boolean;
  canRetry?: boolean;
  onRetry?: () => void;
  activities?: ReplyActivity[];
}) {
  return (
    <div className={`anim-msg group space-y-3 ${currentMatch ? 'chat-search-current' : ''}`}>
      <WorkGroupCard
        reasoning={reasoning}
        reasoningStreaming={reasoningStreaming}
        reasoningStartedAt={reasoningStartedAt}
        reasoningMs={reasoningMs}
        parts={parts}
        streaming={streaming}
        durationMs={durationMs}
        activities={activities}
      />
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
          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-[11px] text-ink-muted/70">已完成 · {formatDuration(durationMs)}</span>
          )}
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

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
