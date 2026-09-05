import { memo } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { Pin } from 'lucide-react';
import {
  ANCHOR_ROLES,
  ANCHOR_STRENGTHS,
  type CanvasAnchorParams,
} from '../../../shared/canvas';
import { EDGE_COLORS } from './edges/edgeStyles';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import NodeHandle from './NodeHandle';
import AgentMark from './AgentMark';
import { useAssetUrl } from './useAssetUrl';
import { useHoverIntent } from './NodeActionBar';

/**
 * A reference pin: one image + a role (character / style / content) + a
 * strength. Non-runnable — consumed by the image executor, which orders the
 * attached anchors first and prepends a semantic prompt prefix.
 */
function AnchorNode({ data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark } = data as CanvasNodeData;
  const params = (node.params as CanvasAnchorParams) ?? { role: 'character', strength: 'mid' };
  const role = params.role ?? 'character';
  const strength = params.strength ?? 'mid';
  const assetUrl = useAssetUrl(node.output?.assets?.[0]);
  const { hovered, hoverProps } = useHoverIntent();

  const set = (patch: Partial<CanvasAnchorParams>): void => {
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, ...patch });
  };

  return (
    <div
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-2 text-xs shadow-sm',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        highlighted && 'canvas-node-highlight',
      )}
      style={{ borderColor: selected ? undefined : EDGE_COLORS.reference }}
    >
      <AgentMark show={agentMark} />
      <NodeHandle
        type="source"
        position={Position.Right}
        kind="reference"
        label="参考"
        expanded={selected || hovered}
      />

      <div className="mb-1.5 flex items-center gap-1">
        <Pin size={12} style={{ color: EDGE_COLORS.reference }} className="shrink-0" />
        <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="参考图钉" />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-paper-inset/40">
        {assetUrl ? (
          <img src={assetUrl} alt="" className="nodrag h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-ink-muted">
            拖一张图到右上「素材栏」即可创建图钉
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
        {ANCHOR_ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => set({ role: r.id })}
            title={r.hint}
            className={cn(
              'nodrag flex-1 rounded-md px-1 py-0.5 text-[10px] font-medium transition-all',
              role === r.id ? 'bg-paper-raised text-ink shadow-xs font-semibold' : 'text-ink-muted hover:text-ink',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-1">
        <span className="text-[10px] text-ink-muted">强度</span>
        <div className="flex flex-1 items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
          {ANCHOR_STRENGTHS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => set({ strength: s.id })}
              className={cn(
                'nodrag flex-1 rounded-md px-1 py-0.5 text-[10px] font-medium transition-all',
                strength === s.id
                  ? 'bg-paper-raised text-ink shadow-xs font-semibold'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(AnchorNode, (prev, next) => {
  const prevData = prev.data as CanvasNodeData;
  const nextData = next.data as CanvasNodeData;
  return (
    prev.selected === next.selected &&
    prevData.sessionId === nextData.sessionId &&
    prevData.highlighted === nextData.highlighted &&
    prevData.agentMark === nextData.agentMark &&
    prevData.isProposal === nextData.isProposal &&
    prevData.node === nextData.node
  );
});
