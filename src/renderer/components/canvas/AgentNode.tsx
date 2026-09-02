import { useEffect, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { CanvasAgentParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import type { CanvasNodeData } from './ImageNode';

export default function AgentNode({ id, data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = node.params as CanvasAgentParams;
  const [instruction, setInstruction] = useState(params.instruction ?? '');

  useEffect(() => {
    setInstruction((params.instruction as string) ?? '');
  }, [params.instruction]);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm',
        selected ? 'border-accent' : 'border-line',
      )}
    >
      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeEnd={(_, p) => canvasStore.resizeNode(sessionId, id, p.width, p.height)}
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />
      <div className="mb-2 truncate font-medium text-ink-muted">{node.title || 'Agent 任务'}</div>
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
