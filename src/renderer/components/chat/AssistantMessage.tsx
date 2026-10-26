import { RotateCcw, Square, Volume2 } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { isSpeechSupported, speakingKey, subscribeSpeech, toggleSpeaking } from '../../lib/speech';
import type { ReasoningSegment, ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import MarkdownContent, { CopyButton } from './MarkdownContent';
import WorkGroupCard from './WorkGroupCard';
import AskAnswers from './AskAnswers';
import GeneratedMediaStrip from './GeneratedMediaStrip';
import ProducedFiles from './ProducedFiles';
import { MessageTranslations, TranslateButton } from './MessageTranslation';
import { deliverableOf } from './DeliverableCard';

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
  sessionId,
  messageId,
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
  /** Set for saved messages; enables per-message actions that need an id (translate). */
  messageId?: string;
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
  const generatedFiles = useMemo(() => (parts ?? []).flatMap(part => {
    const file = part.name === 'generate_file' ? deliverableOf(part) : null;
    return file ? [file] : [];
  }), [parts]);
  return (
    <div className={`anim-msg group space-y-3 ${currentMatch ? 'chat-search-current' : ''}`}>
      <WorkGroupCard
        sessionId={sessionId}
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
        <div data-slot="message-content" className="markdown chat-prose text-ink">
          <MarkdownContent content={content} streaming={streaming} generatedFiles={generatedFiles} />
          {streaming ? <StreamingCaret /> : null}
        </div>
      ) : streaming && !parts?.length && !activities?.length && !reasoning && !reasoningStreaming ? (
        <div className="markdown chat-prose text-ink">
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <StreamingCaret />
            <span className="text-[12px]">正在回复</span>
          </span>
        </div>
      ) : null}
      <ProducedFiles parts={parts} />
      {sessionId && messageId && !streaming ? <MessageTranslations sessionId={sessionId} messageId={messageId} /> : null}
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
            {content && isSpeechSupported() && <SpeakButton text={content} />}
            {content && sessionId && messageId && <TranslateButton sessionId={sessionId} messageId={messageId} />}
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

/** Read the reply aloud / stop. Only one reply plays at a time. */
function SpeakButton({ text }: { text: string }) {
  const key = `${text.length}:${text.slice(0, 40)}`;
  const playing = useSyncExternalStore(subscribeSpeech, () => speakingKey() === key);
  return (
    <button
      type="button"
      onClick={() => toggleSpeaking(key, text)}
      className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink cursor-pointer"
    >
      {playing ? <Square size={11} /> : <Volume2 size={11} />}
      {playing ? '停止朗读' : '朗读'}
    </button>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
