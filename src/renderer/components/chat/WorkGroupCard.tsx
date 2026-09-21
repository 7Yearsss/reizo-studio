import type { ReasoningSegment, ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import { AgentActivity, type AgentActivityItem } from '../agents/agent-activity';
import { ThinkingShimmer } from '../agents/loading-states/thinking-shimmer';
import ThinkingCard, { formatThinkingDuration } from './ThinkingCard';
import ToolCard from './ToolCard';
import { toolAction, toolLabel, toolTarget } from './toolDisplay';

/** Tools whose full card (with its diff or output) stays visible after the turn ends. */
const PERSISTENT_TOOL_NAMES = new Set([
  'edit_file',
  'write_file',
  'memory_write',
  'generate_image',
  'generate_diagram',
  'generate_sheet',
]);

/** Live thinking beats and persisted segments both render as collapsed
 * ThinkingCard rows interleaved with the tool rows they precede. */
function thinkingItem(id: string, props: {
  content: string;
  streaming?: boolean;
  startedAt?: number;
  durationMs?: number;
}): AgentActivityItem {
  return { id, type: 'text', content: <ThinkingCard {...props} /> };
}

export default function WorkGroupCard({
  reasoning,
  reasoningSegments,
  reasoningStreaming = false,
  reasoningMs,
  parts = [],
  streaming = false,
  durationMs,
  activities = [],
  turnOutcome = null,
}: {
  reasoning?: string;
  reasoningSegments?: ReasoningSegment[];
  reasoningStreaming?: boolean;
  reasoningMs?: number;
  parts?: ToolCallPart[];
  streaming?: boolean;
  durationMs?: number;
  activities?: ReplyActivity[];
  turnOutcome?: TurnOutcome | null;
}) {
  // ask_user parts are rendered by AskAnswers/the ask card — a turn that only
  // asked questions (e.g. a folded duplicate direction card) shouldn't leave
  // an empty "工作完成" shell behind.
  const visibleParts = parts.filter((part) => part.name !== 'ask_user');
  const hasReasoning =
    Boolean(reasoning || reasoningStreaming || reasoningSegments?.length) ||
    activities.some((a) => a.kind === 'thinking' && (a.text || a.status === 'running'));
  const hasTools = visibleParts.length > 0;
  const hasActivities = activities.length > 0;
  if (!hasReasoning && !hasTools && !hasActivities) return null;

  const runningToolCount = visibleParts.filter((part) => !part.result && !part.error).length;
  const runningActivity = activities.find((activity) => activity.status === 'running');
  const active = streaming || reasoningStreaming || runningToolCount > 0 || Boolean(runningActivity);
  const items = toActivityItems({
    activities,
    parts: visibleParts,
    segments:
      reasoningSegments ??
      (reasoning ? [{ text: reasoning, durationMs: reasoningMs, beforeToolIndex: 0 }] : undefined),
    detail: !active,
  });
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
      {(items.length > 0 || active) && (
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
      )}
      {active && visibleParts.length > 0 ? (
        <div className="mt-1 flex flex-col items-start gap-1">
          {visibleParts
            .filter((part) => !part.result && !part.error)
            .map((part) => (
              <ToolCard key={part.id} part={part} />
            ))}
        </div>
      ) : null}
      {/* After the turn ends the activity strip collapses, so keep write cards
          (and their diffs) visible — that is the point of the review surface. */}
      {!active && visibleParts.some((part) => PERSISTENT_TOOL_NAMES.has(part.name)) ? (
        <div className="mt-1 flex flex-col items-start gap-1">
          {visibleParts
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
  /** Persisted reasoning beats for the parts-only (historical) path. */
  segments?: ReasoningSegment[];
  /** Turn finished — swap plain tool rows for collapsed ToolCards so each
   * row drills into its full command/output (Claude Code's Ran-N-commands). */
  detail: boolean;
}): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];
  if (input.activities.length > 0) {
    for (const activity of input.activities) {
      if (activity.kind === 'thinking') {
        // A thinking beat with no text at all is a bare phase marker (models
        // that emit no reasoning stream) — don't leave an empty row behind.
        if (!activity.text && activity.status !== 'running') continue;
        items.push(
          thinkingItem(activity.id, {
            content: activity.text ?? '',
            streaming: activity.status === 'running',
            startedAt: activity.startedAt,
            durationMs: activity.durationMs,
          }),
        );
        continue;
      }
      // ask_user's real UI is the ask card under the message stream — a
      // per-call row ('Read 等待你的回答') only echoes noise next to it.
      if (!activity.tool || activity.tool.name === 'ask_user') continue;
      if (input.detail && !PERSISTENT_TOOL_NAMES.has(activity.tool.name)) {
        items.push({
          id: activity.id,
          type: 'text',
          content: <ToolCard part={activity.tool} collapsed />,
        });
        continue;
      }
      items.push({
        id: activity.id,
        type: 'tool',
        action: toolAction(activity.tool.name),
        target: toolTarget(activity.tool) || toolLabel(activity.tool.name),
      });
    }
  } else {
    const segments = input.segments ?? [];
    // Group segments by the tool index they precede so each rendered row sits
    // immediately ahead of the call it motivated.
    const byIndex = new Map<number, ReasoningSegment[]>();
    for (const seg of segments) {
      if (!seg.text) continue;
      const at = Math.max(0, Math.min(seg.beforeToolIndex, input.parts.length));
      const list = byIndex.get(at) ?? [];
      list.push(seg);
      byIndex.set(at, list);
    }
    const flush = (at: number): void => {
      for (const seg of byIndex.get(at) ?? []) {
        items.push(
          thinkingItem(`reasoning-${at}-${items.length}`, {
            content: seg.text,
            durationMs: seg.durationMs,
          }),
        );
      }
    };
    input.parts.forEach((part, index) => {
      flush(index);
      if (part.name === 'ask_user') return;
      if (input.detail && !PERSISTENT_TOOL_NAMES.has(part.name)) {
        items.push({
          id: part.id,
          type: 'text',
          content: <ToolCard part={part} collapsed />,
        });
        return;
      }
      items.push({
        id: part.id,
        type: 'tool',
        action: toolAction(part.name),
        target: toolTarget(part) || toolLabel(part.name),
      });
    });
    flush(input.parts.length);
  }

  const hasTools =
    input.parts.length > 0 ||
    input.activities.some((a) => a.kind === 'tool' && a.tool && a.tool.name !== 'ask_user');
  // A lone thinking row under an empty viewport reads as a broken blank card
  // unless it actually carries reasoning text (those rows are ThinkingCards).
  if (!hasTools && items.every((item) => item.type !== 'text')) return [];
  return items;
}
