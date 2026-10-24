import { useEffect, useMemo } from 'react';
import type { ToolCallPart } from '../../../shared/chat';
import type { CanvasNode } from '../../../shared/canvas';
import { trailEntryFromTool } from '../../../shared/agentTrail';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import MediaGenerationCard from './MediaGenerationCard';

/** Canvas workflows also deliver playable previews in the conversation. */
export default function GeneratedMediaStrip({
  parts,
  sessionId,
}: {
  parts?: ToolCallPart[];
  sessionId: string;
}) {
  const nodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const part of parts ?? []) {
      const trail = trailEntryFromTool(part);
      if (!trail || trail.status !== 'done') continue;
      for (const id of trail.nodeIds) if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [parts]);
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId]);
  // The canvas panel usually already opened the stream during the run; fetch
  // a snapshot lazily so history still shows thumbnails when it never did.
  // Snapshot-only: a live stream per mounted tab would exhaust the socket pool.
  useEffect(() => {
    if (nodeIds.length && !nodes?.length) void canvasStore.ensureCanvasLoaded(sessionId).catch((): void => undefined);
  }, [nodeIds.length, nodes?.length, sessionId]);
  const mediaNodes = useMemo(
    () =>
      nodeIds
        .map((id) => (nodes ?? []).find((n) => n.id === id))
        .filter(
          (n): n is CanvasNode =>
            !!n && (n.type === 'image' || n.type === 'video') && n.runState !== 'idle',
        ),
    [nodeIds, nodes],
  );

  if (!mediaNodes.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {mediaNodes.map((node) => (
        <MediaGenerationCard
          key={node.id}
          sessionId={sessionId}
          part={{ type: 'tool', id: node.id, name: node.type === 'video' ? 'generate_video' : 'generate_image',
            args: node.params as Record<string, unknown>,
            result: JSON.stringify({ nodeId: node.id, canvasId: node.canvasId,
              status: node.runState, error: node.output?.error,
              ...(node.runState === 'done' ? { output: node.output } : {}) }),
          }}
        />
      ))}
    </div>
  );
}
