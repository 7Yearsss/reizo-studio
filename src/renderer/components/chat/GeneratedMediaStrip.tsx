import { useEffect, useMemo } from 'react';
import type { ToolCallPart } from '../../../shared/chat';
import type { CanvasNode } from '../../../shared/canvas';
import { trailEntryFromTool } from '../../../shared/agentTrail';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import * as uiStore from '../../state/uiStore';
import { useAssetUrl } from '../canvas/useAssetUrl';

function MediaThumb({ node, onClick }: { node: CanvasNode; onClick: () => void }) {
  const url = useAssetUrl(node.output?.assets?.[0]);
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={node.title}
      className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-inset transition-transform hover:scale-[1.03]"
    >
      {node.type === 'video' ? (
        <video src={`${url}#t=0.001`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <img src={url} alt={node.title} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

/**
 * Thumbnails of media nodes the agent produced during this message — the
 * canvas is where they live, but the chat should show *that* something was
 * generated. Clicking one spotlights the node on the canvas.
 */
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
            !!n && (n.type === 'image' || n.type === 'video') && !!n.output?.assets?.length,
        ),
    [nodeIds, nodes],
  );

  if (!mediaNodes.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {mediaNodes.map((node) => (
        <MediaThumb
          key={node.id}
          node={node}
          onClick={() => {
            uiStore.setRightPanelTab('canvas');
            canvasStore.focusNode(sessionId, node.id);
          }}
        />
      ))}
    </div>
  );
}
