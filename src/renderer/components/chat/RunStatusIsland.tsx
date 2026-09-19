import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DynamicIsland, DynamicIslandView } from '../motion/dynamic-island';
import { TextShimmer } from '../motion/text-shimmer';
import { useChatStore } from '../../state/useChatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import { liveReplyPhase } from '../../state/liveReply';
import type { ReplyPhase } from '../../../shared/stream';
import type { ToolCallPart } from '../../../shared/chat';

const EMPTY_TOOLS: ToolCallPart[] = [];

const PHASE_LABEL: Record<ReplyPhase, string> = {
  preparing: '准备中',
  thinking: '正在思考',
  tools: '正在使用工具',
  replying: '正在回复',
  waiting: '等待你的回应',
};

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Floating top-center live-status island: agent turn + canvas run progress,
 * expands on hover into per-node / per-tool detail. Invisible when idle. */
export default function RunStatusIsland({ sessionId }: { sessionId: string }) {
  const sending = useChatStore((s) => s.sendingBySession[sessionId]) ?? false;
  const interaction = useChatStore((s) => s.interactionBySession[sessionId]) ?? null;
  const tools = useChatStore((s) => s.streamingToolsBySession[sessionId]) ?? EMPTY_TOOLS;
  const toolCount = useMemo(() => tools.filter((t) => t.result == null && t.error == null).length, [tools]);
  const turnStartedAt = useChatStore((s) => s.turnStartedAtBySession[sessionId]);
  const lastTextAt = useChatStore((s) => s.lastTextAtBySession[sessionId]);
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const runningNodes = useMemo(() => nodes.filter((n) => n.runState === 'running'), [nodes]);

  const [hovered, setHovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const active = sending || runningNodes.length > 0;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const phase =
    liveReplyPhase({
      sending,
      waitingOnUser: Boolean(interaction),
      activeToolCount: toolCount,
      lastTextAt,
      now,
    }) ?? 'thinking';

  const label = interaction
    ? '等待你的回应'
    : runningNodes.length > 0 && !sending
      ? `画布生成中 · ${runningNodes.length} 个节点`
      : `${PHASE_LABEL[phase]}${toolCount > 0 ? ` · ${toolCount} 个工具` : ''}`;

  const elapsed = turnStartedAt ? formatElapsed(now - turnStartedAt) : null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-40 -translate-x-1/2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <DynamicIsland
        view={hovered ? 'detail' : null}
        compact={
          <>
            <Loader2 size={12} className="animate-spin" />
            <TextShimmer className="text-xs">{label}</TextShimmer>
          </>
        }
      >
        <DynamicIslandView id="detail" className="min-w-64">
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between gap-6 font-medium">
              <span>{label}</span>
              {elapsed ? <span className="tabular-nums opacity-60">{elapsed}</span> : null}
            </div>
            {runningNodes.length > 0 ? (
              <div className="flex flex-col gap-0.5 opacity-80">
                {runningNodes.slice(0, 5).map((n) => (
                  <span key={n.id} className="truncate">
                    · {n.title || n.type} 生成中
                  </span>
                ))}
                {runningNodes.length > 5 ? <span>… 等 {runningNodes.length} 个</span> : null}
              </div>
            ) : null}
            {interaction ? (
              <span className="opacity-70">下方消息流里有卡片等你回应</span>
            ) : null}
          </div>
        </DynamicIslandView>
      </DynamicIsland>
    </div>
  );
}
