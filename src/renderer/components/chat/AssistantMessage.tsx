import { Quote, RotateCcw } from 'lucide-react';
import type { ReasoningSegment, ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import MarkdownContent, { CopyButton } from './MarkdownContent';
import WorkGroupCard from './WorkGroupCard';
import AskAnswers from './AskAnswers';
import GeneratedMediaStrip from './GeneratedMediaStrip';
import * as chatStore from '../../state/chatStore';
import { toast } from '../../lib/toast';

function StreamingCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-0.5 animate-pulse rounded-sm bg-accent align-text-bottom"
      aria-hidden
    />
  );
}

function QuoteButton({
  sessionId,
  content,
  className,
}: {
  sessionId?: string;
  content: string;
  className?: string;
}) {
  const handleQuote = () => {
    if (!sessionId || !content) return;
    const selection = window.getSelection()?.toString().trim();
    const quoteText = selection && content.includes(selection) ? selection : content;
    const cleanQuote = quoteText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    chatStore.setComposerSeed(sessionId, `${cleanQuote}\n\n`);
    toast.success('已引用至输入框');
  };

  if (!sessionId || !content) return null;

  return (
    <button
      type="button"
      onClick={handleQuote}
      className={className}
      title="引用回复内容（若选中文本则仅引用所选片段）"
    >
      <Quote size={11} />
      <span>引用</span>
    </button>
  );
}

export default function AssistantMessage({
  content,
  sessionId,
  parts,
  reasoning,
  reasoningSegments,
  reasoningStreaming = false,
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
  sessionId?: string;
  parts?: ToolCallPart[];
  reasoning?: string;
  reasoningSegments?: ReasoningSegment[];
  reasoningStreaming?: boolean;
  reasoningMs?: number;
  durationMs?: number;
  streaming?: boolean;
  currentMatch?: boolean;
  canRetry?: boolean;
  onRetry?: () => void;
  activities?: ReplyActivity[];
  turnOutcome?: TurnOutcome | null;
}) {
  const proposedEdits = parts?.some((part) => /^propose_.*_edits$/.test(part.name)) ?? false;
  return (
    <div className={`anim-msg group space-y-3 ${currentMatch ? 'chat-search-current' : ''}`}>
      <WorkGroupCard
        reasoning={reasoning}
        reasoningSegments={reasoningSegments}
        reasoningStreaming={reasoningStreaming}
        reasoningMs={reasoningMs}
        parts={parts}
        streaming={streaming}
        durationMs={durationMs}
        activities={activities}
        turnOutcome={turnOutcome}
      />
      <AskAnswers parts={parts} />
      {sessionId ? <GeneratedMediaStrip parts={parts} sessionId={sessionId} /> : null}
      {content ? (
        <div data-slot="message-content" className="markdown text-[15px] leading-[1.75] text-ink">
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
      {(Boolean(content) || (parts?.length ?? 0) > 0) && !streaming && (
        <div className="flex items-center gap-3">
          {turnOutcome === 'interrupted' ? (
            <span className="text-[11px] text-amber-500/90">已中断{durationMs ? ` · ${formatDuration(durationMs)}` : ''}</span>
          ) : turnOutcome === 'error' ? (
            <span className="text-[11px] text-danger/80">回复失败{durationMs ? ` · ${formatDuration(durationMs)}` : ''}</span>
          ) : (
            <span className="text-[11px] text-ink-muted/70">
              已完成{durationMs !== undefined && durationMs > 0 && (parts?.length ?? 0) === 0 ? ` · ${formatDuration(durationMs)}` : ''}
            </span>
          )}
          <div className="flex gap-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <CopyButton
              text={content}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink cursor-pointer"
            />
            <QuoteButton
              sessionId={sessionId}
              content={content}
              className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink cursor-pointer"
            />
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                title={proposedEdits ? '重新让 AI 提出修改建议；已接受的修改不会撤销' : undefined}
                className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink cursor-pointer"
              >
                <RotateCcw size={11} />
                {proposedEdits ? '重新提出修改' : '重新生成'}
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
