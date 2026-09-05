import { useEffect, useMemo, useState, memo } from 'react';
import { Panel } from '@xyflow/react';
import { Sparkles, ChevronDown } from 'lucide-react';
import type { AgentTrailEntry } from '../../../shared/agentTrail';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';

/** How long a row stays in the collapsed view before it's only in "展开". */
const RECENT_MS = 45_000;

/**
 * Top-right strip listing the agent's recent canvas writes (newest first).
 * Collapsed: up to 3 recent rows. Expanded: up to 20. Click a row to
 * spotlight the nodes that call touched. Purely derived from the chat
 * tool-event trail — no new channel.
 */
function AgentActivityStrip({ sessionId }: { sessionId: string }) {
  const trail = useCanvasStore((s) => s.trailBySession[sessionId] ?? canvasStore.EMPTY_TRAIL);
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const [expanded, setExpanded] = useState(false);
  const [, tick] = useState(0);

  // Re-render as rows age past RECENT_MS.
  useEffect(() => {
    if (trail.length === 0) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [trail.length]);

  const rows = useMemo(() => [...trail].reverse(), [trail]);
  const recent = rows.filter((e) => Date.now() - e.at < RECENT_MS);
  const shown = expanded ? rows.slice(0, 20) : recent.slice(0, 3);

  if (shown.length === 0) return null;

  const liveIds = new Set(nodes.map((n) => n.id));

  return (
    <Panel position="top-right" className="!mt-11 !mr-2">
      <div className="w-52 overflow-hidden rounded-xl border border-line bg-paper-raised/95 text-[11px] shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-1 border-b border-line/60 px-2 py-1 text-ink-muted">
          <Sparkles size={11} className="text-accent" />
          <span className="font-medium text-ink">Agent 活动</span>
          {rows.length > shown.length || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto rounded p-0.5 hover:bg-paper-inset hover:text-ink"
              title={expanded ? '收起' : `展开最近 ${Math.min(20, rows.length)} 条`}
            >
              <ChevronDown size={11} className={cn('transition-transform', expanded && 'rotate-180')} />
            </button>
          ) : null}
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {shown.map((entry: AgentTrailEntry) => {
            const targets = entry.nodeIds.filter((id) => liveIds.has(id));
            const dead = entry.nodeIds.length > 0 && targets.length === 0;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={dead || targets.length === 0}
                  onClick={() => canvasStore.spotlight(sessionId, targets)}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-paper-inset disabled:opacity-40 disabled:hover:bg-transparent',
                    entry.status === 'error' && 'text-danger',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      entry.status === 'running'
                        ? 'bg-accent animate-pulse'
                        : entry.status === 'error'
                          ? 'bg-danger'
                          : 'bg-ink-muted/50',
                    )}
                  />
                  <span className="truncate text-ink">{entry.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

export default memo(AgentActivityStrip);
