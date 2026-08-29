import { BrainCircuit, Check, ChevronRight, CircleAlert, LoaderCircle, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { ReplyActivity, ToolCallPart } from '../../../shared/chat';
import ThinkingCard, { formatThinkingDuration } from './ThinkingCard';
import ToolCard from './ToolCard';

export default function WorkGroupCard({
  reasoning,
  reasoningStreaming = false,
  reasoningStartedAt,
  reasoningMs,
  parts = [],
  streaming = false,
  durationMs,
  activities = [],
}: {
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningStartedAt?: number;
  reasoningMs?: number;
  parts?: ToolCallPart[];
  streaming?: boolean;
  durationMs?: number;
  activities?: ReplyActivity[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = Boolean(reasoning || reasoningStreaming);
  const hasTools = parts.length > 0;
  const hasActivities = activities.length > 0;
  if (!hasReasoning && !hasTools && !hasActivities) return null;

  const runningToolCount = parts.filter((part) => !part.result && !part.error).length;
  const hasError = parts.some((part) => Boolean(part.error)) || activities.some((activity) => activity.status === 'error');
  const runningActivity = activities.find((activity) => activity.status === 'running');
  const active = streaming || reasoningStreaming || runningToolCount > 0 || Boolean(runningActivity);
  const label = active
    ? runningActivity?.kind === 'thinking' || reasoningStreaming
      ? '正在思考'
      : runningActivity?.kind === 'tool' || runningToolCount > 0
        ? `正在使用工具 · ${runningToolCount} 个`
        : '正在回复'
    : durationMs !== undefined
      ? `工作完成 · ${formatThinkingDuration(durationMs)}`
      : '工作过程';
  const Icon = hasError ? CircleAlert : active ? LoaderCircle : hasTools ? Wrench : BrainCircuit;
  const iconClass = hasError ? 'text-danger' : active ? 'animate-spin text-accent' : 'text-ink-muted';

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 py-1 text-left text-xs text-ink-muted transition-opacity hover:opacity-80"
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
        <span>{label}</span>
        {hasTools && <span className="text-[10px] text-ink-muted/70">{parts.length} 个动作</span>}
        {!active && !hasError && <Check className="h-3.5 w-3.5 text-success" />}
        <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-2 border-l-2 border-line py-1 pl-3">
          {hasActivities ? activities.map((activity) => (
            activity.kind === 'thinking' ? (
              <ThinkingCard
                key={activity.id}
                content={activity.text ?? ''}
                streaming={activity.status === 'running'}
                startedAt={activity.startedAt}
                durationMs={activity.durationMs}
              />
            ) : activity.tool ? (
              <ToolCard key={activity.id} part={activity.tool} />
            ) : null
          )) : hasReasoning ? (
            <ThinkingCard
              key="reasoning"
              content={reasoning ?? ''}
              streaming={reasoningStreaming}
              startedAt={reasoningStartedAt}
              durationMs={reasoningMs}
            />
          ) : null}
          {!hasActivities && parts.map((part) => <ToolCard key={part.id} part={part} />)}
        </div>
      )}
    </div>
  );
}
