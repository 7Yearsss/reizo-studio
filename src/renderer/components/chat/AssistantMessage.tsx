import { RotateCcw } from 'lucide-react';
import type { ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
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
  turnOutcome = null,
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
  turnOutcome?: TurnOutcome | null;
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
        turnOutcome={turnOutcome}
      />
      {content ? (
        <div className="markdown text-[15px] leading-[1.75] text-ink">
          <MarkdownContent content={content} streaming={streaming} />
          {streaming ? <StreamingCaret /> : null}
        </div>
      ) : streaming && !parts?.length && !activities?.length && !reasoning && !reasoningStreaming ? (
        <div className="markdown text-[15px] leading-[1.75] text-ink">
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <StreamingCaret />
            <span className="text-[12px]">正在回复</span>
          </span>
        </div>
      ) : null}
      {(content || parts?.length) && !streaming && (
        <div className="flex items-center gap-3">
          {turnOutcome === 'interrupted' ? (
            <span className="text-[11px] text-amber-500/90">已中断{durationMs ? ` · ${formatDuration(durationMs)}` : ''}</span>
          ) : turnOutcome === 'error' ? (
            <span className="text-[11px] text-danger/80">回复失败{durationMs ? ` · ${formatDuration(durationMs)}` : ''}</span>
          ) : (
            <span className="text-[11px] text-ink-muted/70">
              已完成{durationMs !== undefined && durationMs > 0 ? ` · ${formatDuration(durationMs)}` : ''}
            </span>
          )}
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
