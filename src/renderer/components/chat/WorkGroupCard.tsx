import type { ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import { AgentActivity, type AgentActivityItem } from '../agents/agent-activity';
import { ThinkingShimmer } from '../agents/loading-states/thinking-shimmer';
import { formatThinkingDuration } from './ThinkingCard';
import ToolCard from './ToolCard';
import { toolAction, toolLabel, toolTarget } from './toolDisplay';

/** Tools whose full card (with its diff) stays visible after the turn ends. */
const PERSISTENT_TOOL_NAMES = new Set(['edit_file', 'write_file', 'memory_write']);

export default function WorkGroupCard({
  reasoning,
  reasoningStreaming = false,
  reasoningStartedAt,
  reasoningMs,
  parts = [],
  streaming = false,
  durationMs,
  activities = [],
  turnOutcome = null,
}: {
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningStartedAt?: number;
  reasoningMs?: number;
  parts?: ToolCallPart[];
  streaming?: boolean;
  durationMs?: number;
  activities?: ReplyActivity[];
  turnOutcome?: TurnOutcome | null;
}) {
  const hasReasoning = Boolean(reasoning || reasoningStreaming);
  const hasTools = parts.length > 0;
  const hasActivities = activities.length > 0;
  if (!hasReasoning && !hasTools && !hasActivities) return null;

  const runningToolCount = parts.filter((part) => !part.result && !part.error).length;
  const runningActivity = activities.find((activity) => activity.status === 'running');
  const active = streaming || reasoningStreaming || runningToolCount > 0 || Boolean(runningActivity);
  const items = toActivityItems({ activities, parts, reasoning, reasoningStreaming });
  const liveLabel = runningActivity?.kind === 'thinking' || reasoningStreaming
    ? '正在思考'
    : runningToolCount > 0
      ? `正在使用工具 · ${runningToolCount} 个`
      : '继续处理中';
  const durationLabel = durationMs !== undefined && durationMs > 0
    ? ` · ${formatThinkingDuration(durationMs)}`
    : '';
  const doneLabel = turnOutcome === 'error'
    ? `工作失败${durationLabel}`
    : turnOutcome === 'interrupted'
      ? `工作中断${durationLabel}`
      : `工作完成${durationLabel}`;

  return (
    <div className="w-full">
      <AgentActivity
        items={items}
        contentType={hasTools ? 'tool' : 'mixed'}
        status={active ? 'working' : 'complete'}
        duration={
          durationMs !== undefined && durationMs > 0
            ? Math.round(durationMs / 1000)
            : reasoningMs !== undefined && reasoningMs > 0
              ? Math.round(reasoningMs / 1000)
              : undefined
        }
        collapseOnComplete
        activeLabel={liveLabel}
        summary={doneLabel}
        renderWorkingStatus={({ label }) => <ThinkingShimmer>{label}</ThinkingShimmer>}
        maxHeight={220}
      />
      {active && parts.length > 0 ? (
        <div className="mt-1 flex flex-col gap-1">
          {parts.filter((part) => !part.result && !part.error).map((part) => (
            <ToolCard key={part.id} part={part} />
          ))}
        </div>
      ) : null}
      {/* After the turn ends the activity strip collapses, so keep write cards
          (and their diffs) visible — that is the point of the review surface. */}
      {!active && parts.some((part) => PERSISTENT_TOOL_NAMES.has(part.name)) ? (
        <div className="mt-1 flex flex-col gap-1">
          {parts
            .filter((part) => PERSISTENT_TOOL_NAMES.has(part.name))
            .map((part) => (
              <ToolCard key={part.id} part={part} collapsed />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function toActivityItems(input: {
  activities: ReplyActivity[];
  parts: ToolCallPart[];
  reasoning?: string;
  reasoningStreaming: boolean;
}): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];
  if (input.activities.length > 0) {
    for (const activity of input.activities) {
      if (activity.kind === 'thinking') {
        items.push({
          id: activity.id,
          type: 'trace',
          kind: 'thinking',
          label: activity.status === 'running' ? '思考中' : '已思考',
          detail: activity.text?.slice(0, 80) || undefined,
        });
        continue;
      }
      if (!activity.tool) continue;
      items.push({
        id: activity.id,
        type: 'tool',
        action: toolAction(activity.tool.name),
        target: toolTarget(activity.tool) || toolLabel(activity.tool.name),
      });
    }
  } else {
    if (input.reasoning || input.reasoningStreaming) {
      items.push({
        id: 'reasoning',
        type: 'trace',
        kind: 'thinking',
        label: input.reasoningStreaming ? '思考中' : '已思考',
        detail: input.reasoning?.slice(0, 80) || undefined,
      });
    }
    for (const part of input.parts) {
      items.push({
        id: part.id,
        type: 'tool',
        action: toolAction(part.name),
        target: toolTarget(part) || toolLabel(part.name),
      });
    }
  }

  const hasTools = items.some((item) => item.type === 'tool');
  // The working header already says 正在思考. A lone 思考中 row under an
  // empty 220px viewport is what looked like a broken blank card.
  if (!hasTools) return [];
  return items;
}
