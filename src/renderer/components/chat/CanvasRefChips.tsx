import { useEffect, useMemo } from 'react';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import * as uiStore from '../../state/uiStore';
import { useAssetUrl } from '../canvas/useAssetUrl';
import { ImageIcon } from 'lucide-react';

/**
 * The agent-facing `Referenced canvas nodes:` block appended to user messages
 * carries raw node ids + prompt dumps — machine-readable, not user-facing.
 * Split it out of the display text and render it as thumbnail chips instead.
 */
export function splitCanvasRefs(content: string): { text: string; nodeIds: string[] } {
  const m = content.match(/\n*Referenced canvas nodes:\n((?:- [^\n]*\n?)+)(\n?\(Marked regions[^\n]*\))?/);
  if (!m) return { text: content, nodeIds: [] };
  const nodeIds = [...m[1].matchAll(/^- (\S+) \[/gm)].map((g) => g[1]);
  return { text: content.replace(m[0], '').trimEnd(), nodeIds };
}

function RefChip({ nodeId, sessionId }: { nodeId: string; sessionId?: string }) {
  const node = useCanvasStore((s) =>
    (s.nodesBySession[sessionId ?? ''] ?? []).find((n) => n.id === nodeId),
  );
  const url = useAssetUrl(node?.output?.assets?.[0]);
  return (
    <button
      type="button"
      onClick={() => {
        if (!sessionId) return;
        uiStore.setRightPanelTab('canvas');
        canvasStore.focusNode(sessionId, nodeId);
      }}
      title={node?.title ?? nodeId}
      className="flex h-10 max-w-40 items-center gap-1.5 overflow-hidden rounded-md border border-line bg-paper-inset pl-1 pr-2 text-[11px] text-ink-muted transition-colors hover:text-ink"
    >
      {url ? (
        <img src={url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <ImageIcon size={14} className="ml-1.5 shrink-0" />
      )}
      <span className="truncate">{node?.title ?? '画布节点'}</span>
    </button>
  );
}

export default function CanvasRefChips({ nodeIds, sessionId }: { nodeIds: string[]; sessionId?: string }) {
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId ?? '']);
  // Load canvas data lazily so chips in history resolve their thumbnails.
  const missing = useMemo(
    () => nodeIds.filter((id) => !(nodes ?? []).some((n) => n.id === id)),
    [nodeIds, nodes],
  );
  useEffect(() => {
    if (sessionId && missing.length && !nodes?.length) {
      void canvasStore.openCanvas(sessionId).catch((): void => undefined);
    }
  }, [missing.length, nodes?.length, sessionId]);
  if (!nodeIds.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
      {nodeIds.map((id) => (
        <RefChip key={id} nodeId={id} sessionId={sessionId} />
      ))}
    </div>
  );
}
