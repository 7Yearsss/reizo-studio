import { useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import type { CanvasAgentParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';

export default function AgentNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted } = data as CanvasNodeData;
  const params = node.params as CanvasAgentParams;
  const [instruction, setInstruction] = useState(params.instruction ?? '');
  const resizeStart = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setInstruction((params.instruction as string) ?? '');
  }, [params.instruction]);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm',
        selected ? 'border-accent' : 'border-line',
        highlighted && 'canvas-node-highlight',
      )}
    >
      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeStart={(_, p: ResizeParams) => {
          resizeStart.current = { w: p.width, h: p.height };
        }}
        onResizeEnd={(_, p: ResizeParams) => {
          const from = resizeStart.current;
          resizeStart.current = null;
          if (from) canvasStore.commitResize(sessionId, id, from, { w: p.width, h: p.height });
        }}
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />
      <div className="mb-2 flex">
        <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="Agent 任务" />
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onBlur={() =>
          instruction !== params.instruction &&
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, instruction })
        }
        rows={3}
        placeholder="调研 / 批评 / 改写…"
        className="nodrag min-h-0 flex-1 resize-none rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
      />
      <p className="mt-2 text-[11px] text-ink-muted">Agent 节点的执行在下个版本 (P2) 接入。</p>
    </div>
  );
}
